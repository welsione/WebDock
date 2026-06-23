// ===== 自动更新模块 =====
// 使用 electron-updater + GitHub provider 实现自动更新

import { BrowserWindow } from 'electron'
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import log from 'electron-log'
import { notifyRenderer } from './notification-bridge'
import { APP_ICON } from './icons'
import { UPDATE_CHECK_DELAY_MS } from './config'

let updateInfo: UpdateInfo | null = null
let mainWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null

// ===== 设置窗口引用 =====
export function setUpdateWindows(main: BrowserWindow | null, popup: BrowserWindow | null): void {
  mainWindow = main
  popupWindow = popup
}

// ===== 获取更新信息 =====
export function getUpdateInfo(): UpdateInfo | null {
  return updateInfo
}

// ===== 初始化自动更新 =====
export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateInfo = info
    notifyRenderer(mainWindow, popupWindow, 'update-status', { status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    notifyRenderer(mainWindow, popupWindow, 'update-status', { status: 'none' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    notifyRenderer(mainWindow, popupWindow, 'update-status', { status: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    notifyRenderer(mainWindow, popupWindow, 'update-status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err: Error) => {
    notifyRenderer(mainWindow, popupWindow, 'update-status', { status: 'error', error: err.message })
  })

  // 启动后延迟检查更新
  setTimeout(() => autoUpdater.checkForUpdates().catch(e => log.error('checkForUpdates failed:', e)), UPDATE_CHECK_DELAY_MS)
}

// ===== 手动检查更新 =====
export async function checkUpdate(): Promise<{ ok: boolean; hasUpdate?: boolean; error?: string }> {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, hasUpdate: !!result }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ===== 下载更新 =====
export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ===== 安装更新 =====
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
