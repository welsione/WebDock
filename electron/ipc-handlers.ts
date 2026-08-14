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
  destroyEdgeWindow,
  getActiveWin as getActiveWinFromMgr,
  getMainWindowRef,
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
import {
  sanitizeEnabled, sanitizeCustomProviders, sanitizeOrder,
  sanitizeBuiltInColors, sanitizeTheme, sanitizeProviderKey,
  sanitizeBoolean, sanitizeNumber
} from './ipc-validation'

// ===== 模块状态 =====
// MENUBAR 模式已下线，mode 恒为 WINDOW（保留字段兼容旧设置文件）
const mode: string = MODE.WINDOW
let initialProviderLoaded = false

// ===== 辅助函数 =====
function getActiveWin() {
  return getActiveWinFromMgr()
}

function saveAllSettings(): void {
  saveSettings({
    shortcut: getCurrentShortcut(),
    switchShortcut: getSwitchShortcutValue(),
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
    const validKey = sanitizeProviderKey(key)
    if (validKey) switchProvider(validKey)
  })

  ipcMain.on('reload', () => {
    reloadCurrentProvider()
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
    // IPC 输入不可信：enabled/custom/colors 逐一清洗，防止 undefined 崩溃与非法数据污染状态
    const enabled = sanitizeEnabled(settings?.enabled)
    const custom = sanitizeCustomProviders(settings?.custom)
    const builtInColors = sanitizeBuiltInColors(settings?.builtInColors)

    const oldCustomKeys = new Set(getCustomProvidersList().map(p => p.key))
    const newCustomKeys = new Set(custom.map(p => p.key))
    for (const key of oldCustomKeys) {
      if (!newCustomKeys.has(key)) {
        destroyBrowserView(key)
      }
    }

    const oldEnabled = getEnabledProviders() === null ? PROVIDERS.map(p => p.key) : getEnabledProviders()!
    const newEnabled = enabled === null ? PROVIDERS.map(p => p.key) : enabled
    for (const key of oldEnabled) {
      if (!newEnabled.includes(key)) {
        destroyBrowserView(key)
      }
    }

    setEnabledProviders(enabled)
    setCustomProviders(custom)
    if (builtInColors) {
      setBuiltInColors(builtInColors)
    }
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), 'providers-updated', getMergedProviders() as unknown as Record<string, unknown>)
  })

  ipcMain.handle('save-provider-order', (_event, order: string[]) => {
    setProviderOrder(sanitizeOrder(order))
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), 'providers-updated', getMergedProviders() as unknown as Record<string, unknown>)
  })

  ipcMain.on('sidebar-state', (_event, collapsed: boolean) => {
    const valid = sanitizeBoolean(collapsed)
    if (valid === null) return
    setSidebarCollapsed(valid)
    const win = getActiveWin()
    if (win && !win.isDestroyed()) {
      win.setWindowButtonVisibility(!valid)
    }
    updateBrowserViewBounds()
  })

  ipcMain.on('exit-focus', () => {
    setSidebarCollapsed(false)
    setWindowButtonVisibility(true)
    destroyEdgeWindow()
    updateBrowserViewBounds()
    notifyRenderer(getMainWindowRef(), 'exit-focus-mode', {})
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
    if (typeof acc !== 'string') return { ok: false, error: '快捷键格式不正确' }
    const result = registerGlobalShortcut(acc)
    if (result.ok) {
      setCurrentShortcut(acc)
      saveAllSettings()
    }
    return result
  })

  ipcMain.handle('get-switch-shortcut', () => switchShortcutValue)
  ipcMain.handle('set-switch-shortcut', (_event, acc: string) => {
    if (typeof acc !== 'string') return { ok: false, error: '快捷键格式不正确' }
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
    const validDx = sanitizeNumber(dx)
    const validDy = sanitizeNumber(dy)
    if (validDx === null || validDy === null) return
    const win = getActiveWin()
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + validDx, y + validDy)
  })

  ipcMain.on('theme-changed', (_event, theme: string) => {
    // 白名单校验：THEME_SCRIPTS 仅含 dark/light，任意字符串会导致 executeJavaScript(undefined) 崩溃
    const validTheme = sanitizeTheme(theme)
    if (!validTheme) return
    nativeTheme.themeSource = validTheme
    sendEdgeThemeChange(validTheme)
    const shouldSwitch = handleThemeChange(validTheme, initialProviderLoaded)
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

// ===== 获取 mode（恒为 window，MENUBAR 已下线） =====
export function getMode(): string { return mode }
export function getSwitchShortcut(): string { return switchShortcutValue }
export function setSwitchShortcutVal(v: string): void {
  switchShortcutValue = v
  setViewSwitchShortcut(v)
}
