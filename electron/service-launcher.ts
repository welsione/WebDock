// ===== 本地服务拉起模块 =====
// 网页应用可配置 launch.command（如 `dsh web` / `ollama serve`）：
// 切换时先健康检查，未启动则拉起并轮询等待健康。
// 安全边界：命令仅来自用户本地配置，仅由用户操作（切换/手动按钮）触发。

import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import { app } from 'electron'
import {
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_POLL_INTERVAL_MS,
  LAUNCH_WAIT_TIMEOUT_MS
} from './config'

// ===== 自己拉起的进程跟踪 =====
interface ManagedEntry {
  proc: ChildProcess | null
  pid: number | null
}
const managedProcesses = new Map<string, ManagedEntry>()

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ===== 健康检查 =====
/**
 * 健康检查判定：任何 HTTP 响应（含 4xx/5xx）都视为"服务在跑"，
 * 只有网络错误/超时才算未启动（避免误判 404/500 页面）。
 */
export async function isHealthy(url: string, timeoutMs = HEALTH_CHECK_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    void res
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 轮询等待健康（isHealthyFn 可注入，便于测试状态机） */
export async function waitUntilHealthy(
  url: string,
  opts: {
    timeoutMs?: number
    intervalMs?: number
    isHealthyFn?: (u: string) => Promise<boolean>
  } = {}
): Promise<boolean> {
  const { timeoutMs = LAUNCH_WAIT_TIMEOUT_MS, intervalMs = HEALTH_POLL_INTERVAL_MS, isHealthyFn = isHealthy } = opts
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await isHealthyFn(url)) return true
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

// ===== 拉起与停止 =====
/** 拉起服务进程（detached + shell，输出重定向到 userData/logs/<key>.log） */
export async function launchService(
  key: string,
  launch: WebAppLaunch,
  logDir?: string
): Promise<{ ok: boolean; error?: string; pid?: number | null }> {
  const dir = logDir ?? path.join(app.getPath('userData'), 'logs')
  try {
    await fs.promises.mkdir(dir, { recursive: true })
  } catch (e) {
    return { ok: false, error: `无法创建日志目录：${(e as Error).message}` }
  }
  const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  const logFile = path.join(dir, `${safeName}.log`)
  let out: fs.WriteStream
  try {
    out = fs.createWriteStream(logFile, { flags: 'a' })
    // spawn 的 stdio 需要已打开的流（fd 非 null），等待 open 事件
    await new Promise<void>((resolve, reject) => {
      out.once('open', () => resolve())
      out.once('error', reject)
    })
  } catch (e) {
    return { ok: false, error: `无法打开日志文件：${(e as Error).message}` }
  }

  let proc: ChildProcess
  try {
    proc = spawn(launch.command, {
      shell: true,
      detached: true,
      cwd: launch.cwd || undefined,
      stdio: ['ignore', out, out]
    })
  } catch (e) {
    out.close()
    return { ok: false, error: `启动失败：${(e as Error).message}` }
  }

  proc.on('error', err => {
    log.error(`Service "${key}" spawn error:`, err)
    managedProcesses.delete(key)
  })
  proc.on('exit', () => {
    // 进程退出后移除跟踪（不再视为"由 WebDock 管理"）
    managedProcesses.delete(key)
  })
  proc.unref()

  managedProcesses.set(key, { proc, pid: proc.pid ?? null })
  return { ok: true, pid: proc.pid ?? null }
}

/** 停止由 WebDock 拉起的服务（仅进程组 kill，不接管外部进程） */
export function stopManagedService(key: string): { ok: boolean; error?: string } {
  const entry = managedProcesses.get(key)
  if (!entry || entry.pid == null) {
    return { ok: false, error: '服务不是由 WebDock 启动的' }
  }
  const pid = entry.pid
  try {
    // detached + shell 场景：kill 整个进程组，避免残留子进程
    process.kill(-pid)
  } catch {
    try {
      process.kill(pid)
    } catch (e) {
      managedProcesses.delete(key)
      return { ok: false, error: `停止失败：${(e as Error).message}` }
    }
  }
  managedProcesses.delete(key)
  return { ok: true }
}

/** 退出时关闭所有由 WebDock 启动且配置了 exitWithApp 的服务 */
export function shutdownManagedServices(exitWithAppKeys: string[]): void {
  for (const key of exitWithAppKeys) {
    stopManagedService(key)
  }
}

// ===== 组合流程 =====
/**
 * 确保服务可用：健康 → 直接返回；不健康 → 拉起并轮询等待。
 * @param healthUrl 健康检查地址（默认 = webApp.url）
 * @param opts 可注入轮询参数（测试用）
 */
export async function ensureServiceUp(
  key: string,
  launch: WebAppLaunch,
  healthUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ ok: boolean; launched?: boolean; error?: string }> {
  if (await isHealthy(healthUrl)) return { ok: true, launched: false }
  const launched = await launchService(key, launch)
  if (!launched.ok) return { ok: false, error: launched.error }
  const healthy = await waitUntilHealthy(healthUrl, {
    timeoutMs: opts.timeoutMs,
    intervalMs: opts.intervalMs
  })
  if (!healthy) {
    const timeout = opts.timeoutMs ?? LAUNCH_WAIT_TIMEOUT_MS
    return { ok: false, error: `服务启动超时（${Math.round(timeout / 1000)} 秒），请查看 userData/logs/${key}.log` }
  }
  return { ok: true, launched: true }
}

/** 查询服务运行状态（pid 仅对 WebDock 自己拉起的进程有效） */
export async function getServiceStatus(
  healthUrl: string,
  key?: string
): Promise<{ running: boolean; pid?: number | null }> {
  const running = await isHealthy(healthUrl)
  const entry = key ? managedProcesses.get(key) : undefined
  return { running, pid: entry?.pid ?? null }
}
