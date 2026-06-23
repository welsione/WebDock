// ===== 设置持久化模块 =====
// 负责 settings.json 的读写、备份和持久化

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import { PROVIDERS } from './config'

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

// ===== 读取设置 =====
export function loadSettings(): Settings | null {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch (e) {
    log.error('Failed to load settings:', e)
    // 备份损坏的设置文件
    try {
      const backupPath = SETTINGS_PATH.replace('.json', '.bak.json')
      fs.renameSync(SETTINGS_PATH, backupPath)
      log.info(`Corrupted settings backed up to ${backupPath}`)
    } catch (backupErr) {
      log.error('Failed to backup corrupted settings:', backupErr)
    }
  }
  return null
}

// ===== 保存设置 =====
export function saveSettings(data: {
  shortcut: string
  switchShortcut: string
  mode: string
  enabledProviders: string[] | null
  customProviders: CustomProvider[]
  providerOrder: string[] | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  builtInColors: Record<string, { dark: string; light: string }>
}): void {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data))
  } catch (e) {
    log.error('Failed to save settings:', e)
  }
}
