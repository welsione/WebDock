// ===== IPC 通道注册模块（WebDock） =====
// 注册所有主进程 IPC handler；输入一律经 ipc-validation 清洗

import { app, ipcMain, nativeTheme, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { MODE } from './config'
import { fetchFavicon, fetchIconByUrl } from './icons'
import {
  switchWebApp,
  getMergedWebApps,
  getCurrentWebAppKey,
  getWebAppsList,
  setWebApps,
  setAppSettings,
  setSwitchShortcut as setViewSwitchShortcut,
  setSidebarCollapsed,
  destroyBrowserView,
  reloadCurrentWebApp,
  handleThemeChange,
  getCurrentView,
  updateBrowserViewBounds,
  getAppSettings,
  getWebAppKeyByWebContents,
  attachView,
  detachView
} from './browser-view-manager'
import {
  destroyEdgeWindow,
  getActiveWin as getActiveWinFromMgr,
  getMainWindowRef,
  setWindowButtonVisibility,
  sendEdgeThemeChange
} from './window-manager'
import { saveSettings, DEFAULT_APP_SETTINGS, type StoredWebApp } from './settings-store'
import {
  getCurrentShortcut,
  setCurrentShortcut,
  registerGlobalShortcut
} from './shortcut-manager'
import { checkUpdate, downloadUpdate, installUpdate } from './auto-updater'
import { notifyRenderer, showNativeNotification } from './notification-bridge'
import type { NotificationStore } from './notification-store'
import { ensureServiceUp, getServiceStatus, stopManagedService } from './service-launcher'
import {
  sanitizeWebApp, sanitizeAppSettings, sanitizeOrder,
  sanitizeTheme, sanitizeWebAppKey, sanitizeBoolean, sanitizeNumber
} from './ipc-validation'

// ===== 模块状态 =====
// MENUBAR 模式已下线，mode 恒为 WINDOW（保留字段兼容旧设置文件）
const mode: string = MODE.WINDOW
let initialAppLoaded = false
let switchShortcutValue = 'Shift+Tab'

let notifyStore: NotificationStore | null = null

// ===== 辅助函数 =====
function getActiveWin() {
  return getActiveWinFromMgr()
}

function saveAllSettings(): void {
  void saveSettings({
    shortcut: getCurrentShortcut(),
    switchShortcut: switchShortcutValue,
    webApps: getWebAppsList(),
    appSettings: getAppSettings()
  })
}

// ===== 通知 scope 清洗 =====
function sanitizeReadScope(v: unknown): NotificationReadScope {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const scope: NotificationReadScope = {}
  if (typeof o.all === 'boolean') scope.all = o.all
  if (typeof o.app === 'string' && o.app.length > 0) scope.app = o.app
  if (typeof o.id === 'string' && o.id.length > 0) scope.id = o.id
  return scope
}

// ===== 页面元数据补全（仅用户主动触发） =====
async function fetchPageMeta(url: string): Promise<{ title: string | null; icon: string | null }> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { title: null, icon: null }
  } catch {
    return { title: null, icon: null }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timer)
    if (!res.ok) return { title: null, icon: null }
    const html = (await res.text()).slice(0, 200_000)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim().slice(0, 100) : null
    const icon = await fetchIconByUrl(url)
    return { title: title || null, icon }
  } catch {
    return { title: null, icon: null }
  }
}

// ===== 注册所有 IPC 通道 =====
export function setupIPC(deps: { notifyStore: NotificationStore }): void {
  notifyStore = deps.notifyStore

  // 网页应用通知桥：bridge-preload 转发页面 postMessage → 收件箱流转。
  // 来源按 webContents 反查（页面无法伪造 appKey），内容仍走清洗/限频/去重。
  // 网页应用通知桥：bridge-preload 转发页面 postMessage → 清洗/去重/限频 → macOS 系统通知。
  // 来源按 webContents 反查（页面无法伪造 appKey）。按应用配置决定是否转发系统通知。
  ipcMain.on('webapp-notify', (event, payload: unknown) => {
    const key = getWebAppKeyByWebContents(event.sender)
    if (!key || !notifyStore) return
    void notifyStore.add(payload, key).then(item => {
      if (!item) return
      const webApp = getMergedWebApps().find(a => a.key === item.appKey)
      if (!webApp) return
      const native = webApp.notify?.native ?? getAppSettings().notifyDefaultNative
      if (native) {
        void showNativeNotification(item.title, item.body, webApp.icon, () => {
          void switchWebApp(item.appKey)
          getMainWindowRef()?.show()
          getMainWindowRef()?.focus()
        })
      }
    })
  })

  ipcMain.on('switch-webapp', (_event, key: string) => {
    const validKey = sanitizeWebAppKey(key)
    if (validKey) void switchWebApp(validKey)
  })

  ipcMain.on('reload', () => {
    reloadCurrentWebApp()
  })

  ipcMain.handle('get-mode', () => mode)
  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('get-current-webapp', () => getCurrentWebAppKey())
  ipcMain.handle('get-webapps', () => getMergedWebApps())

  // 网页应用管理
  ipcMain.handle('get-webapp-settings', () => ({
    webApps: getMergedWebApps(),
    appSettings: getAppSettings()
  }))

  ipcMain.handle('save-webapp-settings', (_event, settings: unknown) => {
    // IPC 输入不可信：逐一清洗，防止 undefined 崩溃与非法数据污染状态
    const o = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
    const webApps: StoredWebApp[] = Array.isArray(o.webApps)
      ? o.webApps.map(v => sanitizeWebApp(v)).filter((x): x is NonNullable<typeof x> => !!x)
      : []
    const appSettings = sanitizeAppSettings(o.appSettings, DEFAULT_APP_SETTINGS)

    const oldKeys = new Set(getWebAppsList().map(p => p.key))
    const newKeys = new Set(webApps.map(p => p.key))
    // 删除的应用：销毁 view + 清空通知
    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        destroyBrowserView(key)
        void notifyStore?.clearForApp(key)
      }
    }

    setWebApps(webApps)
    setAppSettings(appSettings)
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), 'webapps-updated', getMergedWebApps() as unknown as Record<string, unknown>)
  })

  ipcMain.handle('save-webapp-order', (_event, order: unknown) => {
    const validOrder = sanitizeOrder(order)
    const current = getWebAppsList()
    const orderMap = new Map(validOrder.map((k, i) => [k, i]))
    const reordered = [...current].sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
    setWebApps(reordered)
    saveAllSettings()
    notifyRenderer(getMainWindowRef(), 'webapps-updated', getMergedWebApps() as unknown as Record<string, unknown>)
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
      detachView(getCurrentWebAppKey())
    } else {
      attachView(getCurrentWebAppKey())
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

  // 图标与元数据获取
  ipcMain.handle('fetch-favicon', async (_event, url: string) => {
    return await fetchFavicon(url)
  })

  ipcMain.handle('fetch-icon-url', async (_event, iconUrl: string) => {
    return await fetchIconByUrl(iconUrl)
  })

  ipcMain.handle('fetch-page-meta', async (_event, url: string) => {
    if (typeof url !== 'string') return { title: null, icon: null }
    return await fetchPageMeta(url)
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
    const shouldSwitch = handleThemeChange(validTheme, initialAppLoaded)
    if (shouldSwitch) {
      initialAppLoaded = true
    }
  })

  // ===== 通知收件箱 =====
  ipcMain.handle('get-notifications', () => {
    return notifyStore?.list() ?? []
  })

  ipcMain.handle('mark-notifications-read', async (_event, scope: unknown) => {
    await notifyStore?.markRead(sanitizeReadScope(scope))
    app.setBadgeCount(notifyStore?.unreadCount() ?? 0)
  })

  ipcMain.handle('clear-notifications', async (_event, scope: unknown) => {
    await notifyStore?.clear(sanitizeReadScope(scope))
    app.setBadgeCount(notifyStore?.unreadCount() ?? 0)
  })

  // ===== 本地服务拉起 =====
  ipcMain.handle('ensure-service-up', async (_event, key: unknown) => {
    const validKey = sanitizeWebAppKey(key)
    if (!validKey) return { ok: false, error: '无效的应用标识' }
    const webApp = getMergedWebApps().find(a => a.key === validKey)
    if (!webApp?.launch) return { ok: false, error: '该应用未配置启动命令' }
    const healthUrl = webApp.launch.healthUrl || webApp.url
    return await ensureServiceUp(validKey, webApp.launch, healthUrl)
  })

  ipcMain.handle('get-service-status', async (_event, key: unknown) => {
    const validKey = sanitizeWebAppKey(key)
    if (!validKey) return { running: false }
    const webApp = getMergedWebApps().find(a => a.key === validKey)
    if (!webApp) return { running: false }
    const healthUrl = webApp.launch?.healthUrl || webApp.url
    return await getServiceStatus(healthUrl, validKey)
  })

  ipcMain.handle('stop-service', async (_event, key: unknown) => {
    const validKey = sanitizeWebAppKey(key)
    if (!validKey) return { ok: false, error: '无效的应用标识' }
    return stopManagedService(validKey)
  })

  // ===== 数据导入导出 =====
  ipcMain.handle('export-data', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindowRef()
    if (!win) return { ok: false, error: '无可用窗口' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出 WebDock 配置',
      defaultPath: 'webdock-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false, error: '已取消' }
    try {
      const data = {
        webApps: getWebAppsList(),
        appSettings: getAppSettings(),
        shortcut: getCurrentShortcut(),
        switchShortcut: switchShortcutValue
      }
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('import-data', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindowRef()
    if (!win) return { ok: false, error: '无可用窗口' }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入 WebDock 配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || filePaths.length === 0) return { ok: false, error: '已取消' }
    try {
      const content = JSON.parse(await fs.promises.readFile(filePaths[0], 'utf-8'))
      const o = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>
      const webApps: StoredWebApp[] = Array.isArray(o.webApps)
        ? o.webApps.map(v => sanitizeWebApp(v)).filter((x): x is NonNullable<typeof x> => !!x)
        : []
      const appSettings = sanitizeAppSettings(o.appSettings, DEFAULT_APP_SETTINGS)
      if (webApps.length === 0) return { ok: false, error: '文件中没有有效的网页应用' }
      // 覆盖式导入：销毁所有现有 view（切换时自动重建）
      for (const key of getWebAppsList().map(p => p.key)) {
        destroyBrowserView(key)
        void notifyStore?.clearForApp(key)
      }
      setWebApps(webApps)
      setAppSettings(appSettings)
      saveAllSettings()
      notifyRenderer(getMainWindowRef(), 'webapps-updated', getMergedWebApps() as unknown as Record<string, unknown>)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
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
