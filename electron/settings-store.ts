// ===== 设置持久化模块 =====
// 负责 settings.json 的读写、备份和持久化（v2：统一 webApps 模型）

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'

// ===== Types =====
/** 存储模型：icon/color 可选（用户可能未设置），运行时合并后必填 */
export interface StoredWebApp {
  key: string
  name: string
  url: string
  icon?: string | null
  color?: WebAppColor
  notify?: WebAppNotify
  permissions?: WebAppPermissions
  trustCertificate?: boolean
  launch?: WebAppLaunch
  preset?: boolean
}

export interface Settings {
  settingsVersion?: number
  webApps?: StoredWebApp[]
  appSettings?: AppSettings
  shortcut?: string
  switchShortcut?: string
  mode?: string
  windowBounds?: { x: number; y: number; width: number; height: number } | null
  /** 各应用最后访问的 URL（会话恢复，退出时写入） */
  lastUrls?: Record<string, string>
  // 旧字段（v1 兼容读取，迁移后不再写入）
  enabledProviders?: string[] | null
  customProviders?: StoredWebApp[]
  providerOrder?: string[] | null
  builtInColors?: Record<string, WebAppColor>
}

export const SETTINGS_VERSION = 2

export const DEFAULT_APP_SETTINGS: AppSettings = {
  notifyDefaultNative: true,
  audioExclusive: true,
  viewCacheLimit: 0,
  clearNotificationsOnQuit: false
}

export const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

// ===== 异步读取设置 =====
export async function loadSettings(): Promise<Settings | null> {
  try {
    await fs.promises.access(SETTINGS_PATH)
    const content = await fs.promises.readFile(SETTINGS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    // 文件不存在时返回 null（正常情况）
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    log.error('Failed to load settings:', e)
    // 备份损坏的设置文件
    try {
      const backupPath = SETTINGS_PATH.replace('.json', '.bak.json')
      await fs.promises.rename(SETTINGS_PATH, backupPath)
      log.info(`Corrupted settings backed up to ${backupPath}`)
    } catch (backupErr) {
      log.error('Failed to backup corrupted settings:', backupErr)
    }
  }
  return null
}

// ===== 串行写队列 =====
// 所有 saveSettings 调用排队执行，避免并发写交错；
// 每次写入前读取当前文件再合并 patch，防止部分字段覆盖其他字段
let writeQueue: Promise<void> = Promise.resolve()

// ===== 保存设置（Partial 合并 + 串行） =====
export function saveSettings(patch: Partial<Settings>): Promise<{ ok: boolean; error?: string }> {
  const result = writeQueue
    .then(async () => {
      const current = await loadSettings()
      const merged = { ...(current ?? {}), ...patch }
      await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(merged))
      return { ok: true as const }
    })
    .catch((e: unknown) => {
      log.error('Failed to save settings:', e)
      return { ok: false as const, error: (e as Error).message }
    })
  writeQueue = result.then(() => undefined)
  return result
}
