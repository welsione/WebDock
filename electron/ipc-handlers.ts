// ===== IPC 通道注册模块 =====
// 负责注册所有主进程 IPC handler

import { app, ipcMain, nativeTheme, clipboard } from 'electron'
import { PROVIDERS, MODE } from './config'
import { fetchFavicon, fetchIconByUrl } from './icons'
import {
  switchProvider,
  getMergedProviders,
  getCurrentProviderKey,
  getEnabledProviders,
  getCustomProvidersList,
  getProviderOrderList,
  getBuiltInColors,
  setEnabledProviders,
  setCustomProviders,
  setProviderOrder,
  setBuiltInColors,
  setSwitchShortcut as setViewSwitchShortcut,
  setSidebarCollapsed,
  destroyBrowserView,
  reloadCurrentProvider,
  injectClipboard,
  handleThemeChange,
  getCurrentView,
  updateBrowserViewBounds
} from './browser-view-manager'
import {
  setMode as setWinMode,
  destroyEdgeWindow,
  getActiveWin as getActiveWinFromMgr,
  getMainWindowRef,
  getPopupWindowRef,
  setWindowButtonVisibility,
  sendEdgeThemeChange
} from './window-manager'
import { saveSettings, type CustomProvider } from './settings-store'
import {
  getCurrentShortcut,
  setCurrentShortcut,
  registerGlobalShortcut
} from './shortcut-manager'
import { checkUpdate, downloadUpdate, installUpdate } from './auto-updater'
import { notifyRenderer } from './notification-bridge'

// ===== 模块状态 =====
let mode: string = MODE.WINDOW
let initialProviderLoaded = false

// ===== 辅助函数 =====
function getActiveWin() {
  return getActiveWinFromMgr(mode)
}

function saveAllSettings(): void {
  saveSettings({
    shortcut: getCurrentShortcut(),
    switchShortcut: getSwitchShortcutValue(),
    mode,
    enabledProviders: getEnabledProviders(),
    customProviders: getCustomProvidersList(),
    providerOrder: getProviderOrderList(),
    builtInColors: getBuiltInColors()
  })
}

let switchShortcutValue = 'Shift+Tab'
function getSwitchShortcutValue(): string { return switchShortcutValue }

// ===== 注册所有 IPC 通道 =====
export function setupIPC(): void {
  ipcMain.on('switch-provider', (_event, key: string) => {
    switchProvider(key)
  })

  ipcMain.on('reload', () => {
    reloadCurrentProvider()
  })

  ipcMain.handle('toggle-mode', () => {
    mode = mode === MODE.WINDOW ? MODE.MENUBAR : MODE.WINDOW
    setWinMode(mode)
    return mode
  })

  ipcMain.handle('get-mode', () => mode)
  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('get-current-provider', () => getCurrentProviderKey())
  ipcMain.handle('get-providers', () => getMergedProviders())

  // 服务商管理
  ipcMain.handle('get-provider-settings', () => ({
    builtIn: PROVIDERS.map(p => ({ key: p.key, name: p.name, url: p.url, icon: p.icon, color: getBuiltInColors()[p.key] || p.color })),
    enabled: getEnabledProviders(),
    custom: getCustomProvidersList(),
    order: getProviderOrderList()
  }))

  ipcMain.handle('save-provider-settings', (_event, settings: { enabled: string[] | null; custom: CustomProvider[]; builtInColors?: Record<string, { dark: string; light: string }> }) => {
    const oldCustomKeys = new Set(getCustomProvidersList().map(p => p.key))
    const newCustomKeys = new Set((settings.custom || []).map(p => p.key))
    for (const key of oldCustomKeys) {
      if (!newCustomKeys.has(key)) {
        destroyBrowserView(key)
      }
    }

    const oldEnabled = getEnabledProviders() === null ? PROVIDERS.map(p => p.key) : getEnabledProviders()!
    const newEnabled = settings.enabled === null ? PROVIDERS.map(p => p.key) : settings.enabled
    for (const key of oldEnabled) {
      if (!newEnabled.includes(key)) {
        destroyBrowserView(key)
      }
    }

    setEnabledProviders(settings.enabled)
    setCustomProviders(settings.custom || [])
    if (settings.builtInColors) {
      setBuiltInColors(settings.builtInColors)
    }
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), getPopupWindowRef(), 'providers-updated', getMergedProviders() as unknown as Record<string, unknown>)
  })

  ipcMain.handle('save-provider-order', (_event, order: string[]) => {
    setProviderOrder(order)
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), getPopupWindowRef(), 'providers-updated', getMergedProviders() as unknown as Record<string, unknown>)
  })

  ipcMain.on('sidebar-state', (_event, collapsed: boolean) => {
    setSidebarCollapsed(collapsed)
    const win = getActiveWin()
    if (win && !win.isDestroyed()) {
      win.setWindowButtonVisibility(!collapsed)
    }
    updateBrowserViewBounds()
  })

  ipcMain.on('exit-focus', () => {
    setSidebarCollapsed(false)
    setWindowButtonVisibility(true)
    destroyEdgeWindow()
    updateBrowserViewBounds()
    notifyRenderer(getMainWindowRef(), getPopupWindowRef(), 'exit-focus-mode', {})
  })

  ipcMain.on('toggle-settings', (_event, show: boolean) => {
    const view = getCurrentView()
    const win = getActiveWin()
    if (!view || !win || view.webContents?.isDestroyed()) return
    if (show) {
      try { win.removeBrowserView(view) } catch { /* may already be removed */ }
    } else {
      win.addBrowserView(view)
      updateBrowserViewBounds()
    }
  })

  ipcMain.handle('get-shortcut', () => getCurrentShortcut())
  ipcMain.handle('set-shortcut', (_event, acc: string) => {
    const result = registerGlobalShortcut(acc)
    if (result.ok) {
      setCurrentShortcut(acc)
      saveAllSettings()
    }
    return result
  })

  ipcMain.handle('get-switch-shortcut', () => switchShortcutValue)
  ipcMain.handle('set-switch-shortcut', (_event, acc: string) => {
    if (acc && acc === getCurrentShortcut()) {
      return { ok: false, error: '与全局快捷键冲突，请选择其他组合' }
    }
    switchShortcutValue = acc || 'Shift+Tab'
    setViewSwitchShortcut(switchShortcutValue)
    saveAllSettings()
    return { ok: true }
  })

  // 图标获取
  ipcMain.handle('fetch-favicon', async (_event, url: string) => {
    return await fetchFavicon(url)
  })

  ipcMain.handle('fetch-icon-url', async (_event, iconUrl: string) => {
    return await fetchIconByUrl(iconUrl)
  })

  // 剪贴板注入
  ipcMain.handle('inject-clipboard', async () => {
    const text = clipboard.readText()
    return await injectClipboard(text)
  })

  ipcMain.on('move-window', (_event, dx: number, dy: number) => {
    const win = getActiveWin()
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  ipcMain.on('theme-changed', (_event, theme: string) => {
    nativeTheme.themeSource = theme as typeof nativeTheme.themeSource
    sendEdgeThemeChange(theme)
    const shouldSwitch = handleThemeChange(theme, initialProviderLoaded)
    if (shouldSwitch) {
      initialProviderLoaded = true
    }
    if (!initialProviderLoaded) {
      initialProviderLoaded = true
    }
  })

  // 自动更新
  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) return { ok: false, error: '开发模式不支持更新' }
    return await checkUpdate()
  })

  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) return { ok: false }
    return await downloadUpdate()
  })

  ipcMain.handle('install-update', () => {
    if (!app.isPackaged) return
    installUpdate()
  })
}

// ===== 获取 mode =====
export function getMode(): string { return mode }
export function setModeValue(m: string): void { mode = m }
export function getSwitchShortcut(): string { return switchShortcutValue }
export function setSwitchShortcutVal(v: string): void {
  switchShortcutValue = v
  setViewSwitchShortcut(v)
}
