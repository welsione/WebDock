// ===== MineAI Hub — 主进程入口 =====
// 仅负责模块组装和初始化，业务逻辑拆分至各子模块

import { app } from 'electron'
import { loadSettings, saveSettings } from './settings-store'
import {
  switchProvider, getCurrentProviderKey, initBrowserViewManager,
  setEnabledProviders, setCustomProviders, setProviderOrder,
  setBuiltInColors, updateBrowserViewBounds, getViewsMap
} from './browser-view-manager'
import {
  createMainWindow, showMainWindow, toggleWindowVisibility,
  getMainWindowRef, getPopupWindowRef, createEdgeWindow, destroyEdgeWindow,
  getActiveWin as getActiveWinFromMgr,
  setSavedBounds, getSavedBoundsValue, initWindowManager
} from './window-manager'
import { getCurrentShortcut, setCurrentShortcut, registerGlobalShortcut, setToggleHandler, unregisterAllShortcuts } from './shortcut-manager'
import { setupNotificationBridge, showNativeNotification } from './notification-bridge'
import { setupIPC, getMode, setModeValue, setSwitchShortcutVal } from './ipc-handlers'
import { setupAutoUpdater, setUpdateWindows } from './auto-updater'
import { buildMenu } from './app-menu'
import { MODE } from './config'

function saveWindowBounds(): void {
  const main = getMainWindowRef()
  if (!main || main.isDestroyed()) return
  const b = main.getBounds()
  setSavedBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  // 只保存窗口边界，其他设置由各自模块负责，避免全量覆盖丢失用户配置
  saveSettings({ windowBounds: getSavedBoundsValue() })
}

initWindowManager({
  updateBrowserViewBounds, saveWindowBounds, switchProvider, getCurrentProviderKey,
  hasView: (k) => getViewsMap().has(k),
  onWindowClose: () => {}
})

// BrowserView 管理器的窗口依赖注入（拆分后必须在入口显式组装，否则 switchProvider 无法工作）
initBrowserViewManager({
  getMainWindow: getMainWindowRef,
  getPopupWindow: getPopupWindowRef,
  getActiveWin: () => getActiveWinFromMgr(getMode()),
  onProviderSwitched: () => {},
  createEdgeWindow: (win) => createEdgeWindow(win),
  destroyEdgeWindow
})

setToggleHandler(toggleWindowVisibility)

app.whenReady().then(async () => {
  const s = await loadSettings()
  if (s) {
    if (s.shortcut) setCurrentShortcut(s.shortcut)
    if (s.switchShortcut) setSwitchShortcutVal(s.switchShortcut)
    if (s.enabledProviders !== undefined) setEnabledProviders(s.enabledProviders)
    if (s.customProviders) setCustomProviders(s.customProviders)
    if (s.providerOrder) setProviderOrder(s.providerOrder)
    if (s.windowBounds) setSavedBounds(s.windowBounds)
    if (s.builtInColors) setBuiltInColors(s.builtInColors)
    if (s.mode) setModeValue(s.mode)
  }
  setupNotificationBridge((t, b, icon, key) =>
    showNativeNotification(t, b, icon, key, switchProvider, showMainWindow))
  setupIPC()
  createMainWindow(getMode())
  buildMenu()
  const r = registerGlobalShortcut(getCurrentShortcut())
  if (!r.ok) console.error('Failed to register global shortcut:', r.error)
  if (app.isPackaged) {
    setUpdateWindows(getMainWindowRef(), getPopupWindowRef())
    setupAutoUpdater()
  }
})

app.on('will-quit', unregisterAllShortcuts)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (getMode() === MODE.WINDOW) showMainWindow() })
app.on('web-contents-created', (_e, c) => {
  if (c.getType() !== 'window') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(c as any).on('will-navigate', (ev: Event & { preventDefault: () => void }, url: string) => {
    if (url.startsWith('file://')) return
    if (import.meta.env.DEV && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return
    ev.preventDefault()
  })
})
