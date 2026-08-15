// ===== 通知桥接模块 =====
// 页面通知经 bridge-preload（postMessage → IPC 'webapp-notify'）进入收件箱，
// 本模块只负责原生通知展示与渲染进程推送。
// 不再使用 console-message（Electron 35 起废弃，37 移除）。

import { Notification } from 'electron'
import { dataUrlToNativeImage, writeIconToTempFile } from './icons'

// ===== 原生通知（转发系统通知） =====
export async function showNativeNotification(
  title: string,
  body: string,
  iconDataUrl?: string,
  onSwitch?: () => void
): Promise<void> {
  if (!Notification.isSupported()) return
  const options: Electron.NotificationConstructorOptions = { title, body }
  if (iconDataUrl) {
    const img = dataUrlToNativeImage(iconDataUrl)
    if (img) {
      const tmpPath = await writeIconToTempFile(img)
      options.icon = process.platform === 'darwin' ? tmpPath ?? img : img
    }
  }
  const n = new Notification(options)
  if (onSwitch) {
    n.on('click', onSwitch)
  }
  n.show()
}

// ===== 通知渲染进程 =====
export function notifyRenderer(
  mainWindow: Electron.BrowserWindow | null,
  channel: string,
  data: Record<string, unknown>
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}
