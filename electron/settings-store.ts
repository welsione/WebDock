// ===== 设置持久化模块 =====
// 负责 settings.json 的读写、备份和持久化

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'

// ===== Types =====
export interface CustomProvider {
  key: string
  name: string
  url: string
  icon?: string
  color?: { dark: string; light: string }
}

export interface Settings {
  shortcut?: string
  switchShortcut?: string
  mode?: string
  enabledProviders?: string[] | null
  customProviders?: CustomProvider[]
  providerOrder?: string[] | null
  windowBounds?: { x: number; y: number; width: number; height: number } | null
  builtInColors?: Record<string, { dark: string; light: string }>
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

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

// ===== 异步保存设置 =====
export async function saveSettings(data: {
  shortcut: string
  switchShortcut: string
  mode: string
  enabledProviders: string[] | null
  customProviders: CustomProvider[]
  providerOrder: string[] | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  builtInColors: Record<string, { dark: string; light: string }>
}): Promise<void> {
  try {
    await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(data))
  } catch (e) {
    log.error('Failed to save settings:', e)
  }
}
