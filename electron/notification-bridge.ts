// ===== 通知桥接模块 =====
// 拦截页面内 Notification API，通过 console.log 桥接回主进程，转发为原生通知

import { app, Notification, session, webContents } from 'electron'
import log from 'electron-log'
import { dataUrlToNativeImage, writeIconToTempFile } from './icons'

// ===== 原生通知 =====
export async function showNativeNotification(
  title: string,
  body: string,
  iconDataUrl?: string,
  providerKey?: string,
  onSwitchProvider?: (key: string) => void,
  onShowMainWindow?: () => void
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
  n.on('click', () => {
    if (providerKey && onSwitchProvider) {
      onSwitchProvider(providerKey)
    }
    if (onShowMainWindow) onShowMainWindow()
  })
  n.show()
}

// ===== 单个 webContents 通知监听 =====
function setupWebContentsNotificationListener(wc: Electron.WebContents): void {
  if ((wc as unknown as Record<string, unknown>)._notifyListened) return
  ;(wc as unknown as Record<string, unknown>)._notifyListened = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(wc as any).on('console-message', (_event: Electron.Event, details: Electron.WebContentsConsoleMessageEventParams) => {
    const message = details.message
    if (!message || !message.startsWith('__MINEAI_NOTIFY__:')) return
    try {
      const data = JSON.parse(message.slice('__MINEAI_NOTIFY__:'.length))
      log.info('Notification bridge received:', data.title, 'icon:', data._ico ? 'has icon' : 'no icon')
      if (data.title) {
        // 回调由 setupNotificationBridge 注入
        const handler = (globalThis as Record<string, unknown>).__mineaiNotifyHandler
        if (typeof handler === 'function') {
          handler(data.title, data.body || '', data._ico, data._key)
        }
      }
    } catch { /* ignore malformed notify message */ }
  })
}

// ===== 初始化通知桥接 =====
export function setupNotificationBridge(
  onNotify: (title: string, body: string, iconDataUrl?: string, providerKey?: string) => void
): void {
  // 注册全局通知处理器
  ;(globalThis as Record<string, unknown>).__mineaiNotifyHandler = onNotify

  // 监听所有已有 webContents
  webContents.getAllWebContents().forEach(wc => {
    setupWebContentsNotificationListener(wc)
  })

  // 新创建的 webContents 也监听
  app.on('web-contents-created', (_e, contents) => {
    setupWebContentsNotificationListener(contents)
  })

  // 自动授予通知权限
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
    } else {
      callback(false)
    }
  })
}

// ===== 通知渲染进程（MENUBAR 弹窗已下线，仅主窗口） =====
export function notifyRenderer(
  mainWindow: Electron.BrowserWindow | null,
  channel: string,
  data: Record<string, unknown>
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}
