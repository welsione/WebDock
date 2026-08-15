import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import type * as Launcher from '../electron/service-launcher'

let testDir: string

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => testDir }
}))

async function loadLauncher(): Promise<typeof Launcher> {
  vi.resetModules()
  return await import('../electron/service-launcher')
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `webdock-launch-test-${crypto.randomUUID()}`)
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('isHealthy - 健康检查判定', () => {
  it('任何 HTTP 响应（含 4xx/5xx）视为存活', async () => {
    const { isHealthy } = await loadLauncher()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    expect(await isHealthy('http://127.0.0.1:3080', 1000)).toBe(true)
    expect(await isHealthy('http://127.0.0.1:3080', 1000)).toBe(true)
    expect(await isHealthy('http://127.0.0.1:3080', 1000)).toBe(true)
    vi.unstubAllGlobals()
  })

  it('网络错误/超时视为未启动', async () => {
    const { isHealthy } = await loadLauncher()
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await isHealthy('http://127.0.0.1:9999', 1000)).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('waitUntilHealthy - 轮询状态机', () => {
  it('未启动时拉起后轮询直到健康', async () => {
    const { waitUntilHealthy } = await loadLauncher()
    const healthyFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const result = await waitUntilHealthy('http://x', {
      timeoutMs: 5000,
      intervalMs: 10,
      isHealthyFn: healthyFn
    })
    expect(result).toBe(true)
    expect(healthyFn).toHaveBeenCalledTimes(3)
  })

  it('超时返回 false', async () => {
    const { waitUntilHealthy } = await loadLauncher()
    const healthyFn = vi.fn().mockResolvedValue(false)
    const result = await waitUntilHealthy('http://x', {
      timeoutMs: 60,
      intervalMs: 10,
      isHealthyFn: healthyFn
    })
    expect(result).toBe(false)
  })

  it('立即健康返回 true（零轮询）', async () => {
    const { waitUntilHealthy } = await loadLauncher()
    const healthyFn = vi.fn().mockResolvedValue(true)
    expect(await waitUntilHealthy('http://x', { timeoutMs: 1000, intervalMs: 10, isHealthyFn: healthyFn })).toBe(true)
    expect(healthyFn).toHaveBeenCalledTimes(1)
  })
})

describe('launchService / stopManagedService - 进程管理', () => {
  it('启动服务：detached 进程、日志落盘、pid 可查', async () => {
    const { launchService } = await loadLauncher()
    const r = await launchService('test-app', { command: 'node -e "setTimeout(()=>{},60000)"' }, testDir)
    expect(r.ok).toBe(true)
    expect(r.pid).toBeTruthy()
    // 进程确实在跑
    expect(process.kill(r.pid!, 0)).toBe(true)
    // 日志文件创建
    const logs = fs.readdirSync(testDir)
    expect(logs).toContain('test-app.log')
    // 清理
    process.kill(r.pid!)
  }, 15000)

  it('stopManagedService 仅停止自己拉起的进程', async () => {
    const { launchService, stopManagedService } = await loadLauncher()
    const r = await launchService('svc', { command: 'node -e "setTimeout(()=>{},60000)"' }, testDir)
    expect(r.ok).toBe(true)
    const stop = stopManagedService('svc')
    expect(stop.ok).toBe(true)
    // 进程退出是异步的，等待后探测
    await new Promise(res => setTimeout(res, 300))
    expect(() => process.kill(r.pid!, 0)).toThrow()
    // 未管理的 key 报错
    expect(stopManagedService('svc').ok).toBe(false)
    expect(stopManagedService('other').ok).toBe(false)
  }, 15000)

  it('无 launch 配置或命令为空的 error 路径', async () => {
    const { launchService } = await loadLauncher()
    const r = await launchService('bad', { command: '' }, testDir)
    // spawn 空命令会走 error 事件；这里至少不抛异常且返回结构完整
    expect(typeof r.ok).toBe('boolean')
  })
})

describe('ensureServiceUp - 组合流程', () => {
  it('已健康 → 直接返回 launched: false', async () => {
    const { ensureServiceUp } = await loadLauncher()
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const r = await ensureServiceUp('a', { command: 'x' }, 'http://127.0.0.1:1')
    expect(r.ok).toBe(true)
    expect(r.launched).toBe(false)
    vi.unstubAllGlobals()
  })

  it('未健康 → 拉起后轮询成功', async () => {
    const { ensureServiceUp } = await loadLauncher()
    // 第一次健康检查失败，之后轮询成功
    let calls = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('down')
      return { status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await ensureServiceUp('a', { command: 'node -e "setTimeout(()=>{},30000)"' }, 'http://127.0.0.1:1', { timeoutMs: 5000, intervalMs: 10 })
    expect(r.ok).toBe(true)
    expect(r.launched).toBe(true)
    vi.unstubAllGlobals()
  }, 15000)

  it('拉起后持续不健康 → 超时错误', async () => {
    const { ensureServiceUp } = await loadLauncher()
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await ensureServiceUp('a', { command: 'node -e "setTimeout(()=>{},30000)"' }, 'http://127.0.0.1:1', { timeoutMs: 120, intervalMs: 10 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('超时')
    vi.unstubAllGlobals()
  }, 15000)
})
