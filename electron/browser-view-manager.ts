// ===== BrowserView 管理模块（WebDock） =====
// 负责网页应用 BrowserView 的创建、切换、销毁和布局更新；
// 本地服务拉起、跨域导航策略、音频独占、标题同步、右键菜单在此接线。

import { BrowserView, BrowserWindow, Menu, shell } from 'electron'
import path from 'path'
import log from 'electron-log'
import {
  PRESET_WEB_APPS,
  NEEDS_THEME_RELOAD,
  SIDEBAR_WIDTH,
  EDGE_WIDTH,
  THEME_SCRIPTS,
  buildNotifyHook,
  matchesKeyEvent,
  THEME_RELOAD_DELAY_MS,
  THEME_INJECT_DELAY_MS
} from './config'
import { generateLetterIcon } from './icons'
import { notifyRenderer } from './notification-bridge'
import { decideNavigation } from './navigation'
import { ensureServiceUp } from './service-launcher'
import type { StoredWebApp } from './settings-store'

// ===== 状态 =====
const views = new Map<string, BrowserView>()
const viewLastUsed = new Map<string, number>()
/** 已挂载到窗口的 view（add/remove 幂等管理，避免重复 attach） */
const attachedViews = new Set<string>()
/** 各应用最后访问的 URL（会话恢复：重启后加载上次位置） */
const viewUrls = new Map<string, string>()
let currentWebAppKey = 'deepseek'
let webApps: StoredWebApp[] = []
let appSettings: AppSettings = {
  notifyDefaultNative: true,
  audioExclusive: true,
  viewCacheLimit: 0,
  clearNotificationsOnQuit: false
}
let currentTheme = 'dark'
let switchShortcut = 'Shift+Tab'
let sidebarCollapsed = false

// did-fail-load 网络错误后已尝试拉起重试的应用（避免死循环）
const launchRetried = new Set<string>()

// ===== 外部回调 =====
let getMainWindow: () => BrowserWindow | null = () => null
let getActiveWin: () => BrowserWindow | null = () => null
let onWebAppSwitched: ((key: string) => void) | null = null
let createEdgeWindowFn: ((win: BrowserWindow) => void) | null = null
let destroyEdgeWindowFn: () => void = () => {}
let onPageTitleCb: ((key: string, title: string) => void) | null = null

// ===== 初始化回调注入 =====
export function initBrowserViewManager(deps: {
  getMainWindow: () => BrowserWindow | null
  getActiveWin: () => BrowserWindow | null
  onWebAppSwitched: (key: string) => void
  createEdgeWindow: (win: BrowserWindow) => void
  destroyEdgeWindow: () => void
  onPageTitle: (key: string, title: string) => void
}): void {
  getMainWindow = deps.getMainWindow
  getActiveWin = deps.getActiveWin
  onWebAppSwitched = deps.onWebAppSwitched
  createEdgeWindowFn = deps.createEdgeWindow
  destroyEdgeWindowFn = deps.destroyEdgeWindow
  onPageTitleCb = deps.onPageTitle
}

// ===== 状态设置器 =====
export function setWebApps(apps: StoredWebApp[]): void { webApps = apps }
export function setAppSettings(s: AppSettings): void { appSettings = s }
export function setSwitchShortcut(shortcut: string): void { switchShortcut = shortcut }
export function setSidebarCollapsed(collapsed: boolean): void { sidebarCollapsed = collapsed }

// ===== 状态获取器 =====
export function getCurrentWebAppKey(): string { return currentWebAppKey }
export function getViewsMap(): Map<string, BrowserView> { return views }
export function getWebAppsList(): StoredWebApp[] { return webApps }
export function getAppSettings(): AppSettings { return appSettings }

// ===== 合并网页应用列表（icon/color 回退） =====
export function getMergedWebApps(): WebAppInfo[] {
  return webApps.map(p => ({
    ...p,
    icon: p.icon || generateLetterIcon(p.name),
    color: p.color || { dark: '#1a1e28', light: '#f0f2f5' }
  }))
}

// ===== 会话恢复（浏览位置） =====
function isSameOriginUrl(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

export function getViewUrls(): Record<string, string> {
  return Object.fromEntries(viewUrls)
}

export function setViewUrls(urls: Record<string, string> | undefined): void {
  viewUrls.clear()
  if (!urls) return
  for (const [k, v] of Object.entries(urls)) {
    if (typeof v === 'string' && v.startsWith('http')) viewUrls.set(k, v)
  }
}

/** 反查 webContents 属于哪个应用（权限/证书处理用） */
export function getWebAppKeyByWebContents(wc: Electron.WebContents): string | null {
  for (const [key, view] of views) {
    if (view.webContents && !view.webContents.isDestroyed() && view.webContents === wc) return key
  }
  return null
}

// ===== LRU 裁剪 =====
function pruneViews(): void {
  const limit = appSettings.viewCacheLimit
  if (limit <= 0 || views.size <= limit) return
  const sorted = [...viewLastUsed.entries()].sort((a, b) => a[1] - b[1])
  for (const [key] of sorted) {
    if (views.size <= limit) break
    if (key === currentWebAppKey) continue
    destroyBrowserView(key)
  }
}

// ===== 更新 BrowserView 边界 =====
export function updateBrowserViewBounds(): void {
  const view = views.get(currentWebAppKey)
  if (!view || view.webContents?.isDestroyed()) return

  const win = getActiveWin()
  if (!win) return

  const contentBounds = win.getContentBounds()
  const effectiveSidebarWidth = sidebarCollapsed ? EDGE_WIDTH : SIDEBAR_WIDTH

  view.setBounds({
    x: effectiveSidebarWidth,
    y: Math.max(0, contentBounds.y - win.getBounds().y),
    width: contentBounds.width - effectiveSidebarWidth,
    height: contentBounds.height
  })

  if (sidebarCollapsed) {
    if (createEdgeWindowFn) createEdgeWindowFn(win)
  } else {
    destroyEdgeWindowFn()
  }
}

// ===== 挂载/摘除 view（幂等） =====
export function attachView(key: string): void {
  if (attachedViews.has(key)) return
  const view = views.get(key)
  const win = getActiveWin()
  if (!view || !win || win.isDestroyed()) return
  if (!view.webContents || view.webContents.isDestroyed()) return
  try {
    win.addBrowserView(view)
    attachedViews.add(key)
    updateBrowserViewBounds()
  } catch (e) {
    log.error('attachView failed:', e)
  }
}

export function detachView(key: string): void {
  if (!attachedViews.has(key)) return
  const view = views.get(key)
  const win = getActiveWin()
  if (!view || !win || win.isDestroyed()) return
  try {
    win.removeBrowserView(view)
  } catch { /* may already be removed */ }
  attachedViews.delete(key)
}

// ===== 销毁 BrowserView =====
export function destroyBrowserView(key: string): void {
  detachView(key)
  const view = views.get(key)
  if (view) {
    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        setImmediate(() => {
          try {
            view.webContents?.close()
          } catch (e) {
            log.error('Failed to close BrowserView webContents:', e)
          }
        })
      }
    } catch (e) {
      log.error('Failed to close BrowserView:', e)
    }
    views.delete(key)
    viewLastUsed.delete(key)
    attachedViews.delete(key)
  }
}

// ===== 原生右键菜单 =====
function showContextMenu(wc: Electron.WebContents, params: Electron.ContextMenuParams): void {
  const hasSelection = params.selectionText.trim().length > 0
  const isEditable = params.isEditable
  const nav = wc.navigationHistory
  const template: Electron.MenuItemConstructorOptions[] = []
  if (nav.canGoBack()) template.push({ label: '后退', click: () => nav.goBack() })
  if (nav.canGoForward()) template.push({ label: '前进', click: () => nav.goForward() })
  if (nav.canGoBack() || nav.canGoForward()) template.push({ type: 'separator' })
  template.push({ label: '刷新', click: () => wc.reload() })
  template.push({ type: 'separator' })
  if (isEditable || hasSelection) {
    template.push({ label: '复制', role: 'copy', enabled: hasSelection })
    if (isEditable) {
      template.push({ label: '粘贴', role: 'paste' })
      template.push({ label: '剪切', role: 'cut', enabled: hasSelection })
    }
    template.push({ type: 'separator' })
  }
  template.push({ label: '全选', role: 'selectAll' })
  template.push({ type: 'separator' })
  if (params.linkURL) {
    template.push({ label: '在浏览器中打开链接', click: () => shell.openExternal(params.linkURL) })
  }
  template.push({ label: '在浏览器中打开页面', click: () => shell.openExternal(wc.getURL()) })
  if (import.meta.env.DEV) {
    template.push({ type: 'separator' })
    template.push({ label: '检查元素', click: () => wc.inspectElement(params.x, params.y) })
  }
  Menu.buildFromTemplate(template).popup()
}

// ===== 音频独占 =====
function applyAudioExclusive(activeKey: string): void {
  if (!appSettings.audioExclusive) return
  for (const [key, view] of views) {
    if (!view.webContents || view.webContents.isDestroyed()) continue
    try {
      view.webContents.setAudioMuted(key !== activeKey)
    } catch { /* view 正在销毁 */ }
  }
}

// ===== 切换网页应用 =====
export async function switchWebApp(key: string): Promise<void> {
  // 状态去重：如果已经是当前应用且 view 存在，跳过
  if (key === currentWebAppKey && views.has(key)) return

  const app = getMergedWebApps().find(p => p.key === key)
  if (!app) return

  const win = getActiveWin()
  if (!win || win.isDestroyed()) return

  // 隐藏当前 view
  detachView(currentWebAppKey)

  // 本地服务拉起：未运行则启动并等待健康
  if (app.launch) {
    const healthUrl = app.launch.healthUrl || app.url
    notifyRenderer(getMainWindow(), 'loading', { app: key, status: 'starting' })
    const result = await ensureServiceUp(key, app.launch, healthUrl)
    if (!result.ok) {
      notifyRenderer(getMainWindow(), 'loading', { app: key, status: 'error', error: result.error })
      return
    }
  }

  // 获取或创建目标 view
  let view = views.get(key)
  let isNewlyCreated = false
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    isNewlyCreated = true
    view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        // 通知桥 preload：监听页面 postMessage，不向页面暴露任何 API
        preload: path.join(__dirname, '../preload/bridge.js')
      }
    })
    views.set(key, view)

    // 安全：外链在浏览器中打开
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // 导航策略：跨域主 frame 导航 → 外部打开
    view.webContents.on('will-navigate', (event, url) => {
      const decision = decideNavigation(view!.webContents.getURL(), url)
      if (!decision.keepInApp) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })

    // 页面标题：当前应用 → 同步窗口标题
    view.webContents.on('page-title-updated', (_e, title) => {
      if (currentWebAppKey === key && onPageTitleCb) {
        onPageTitleCb(key, title)
      }
    })

    // 记录浏览位置（含 SPA 路由变化）：重启后恢复到上次 URL
    const recordUrl = (url: string) => {
      if (url && url.startsWith('http')) viewUrls.set(key, url)
    }
    view.webContents.on('did-navigate', (_e, url) => recordUrl(url))
    view.webContents.on('did-navigate-in-page', (_e, url) => recordUrl(url))

    // 原生右键菜单
    view.webContents.on('context-menu', (_e, params) => {
      showContextMenu(view!.webContents, params)
    })

    // 恢复上次浏览位置（仅同源，防止应用 URL 变更后加载旧地址）
    let startUrl = app.url
    const lastUrl = viewUrls.get(key)
    if (lastUrl && isSameOriginUrl(lastUrl, app.url)) {
      startUrl = lastUrl
      log.info(`[session] restore ${key} → ${lastUrl}`)
    }
    view.webContents.loadURL(startUrl).catch(e => {
      // ERR_ABORTED (-3) 是正常导航中止（重定向/页面自身跳转），不是错误
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ERR_ABORTED' || err.errno === -3) return
      log.error('loadURL failed:', e)
    })
    notifyRenderer(getMainWindow(), 'loading', { app: key, status: 'loading' })

    // 切换应用快捷键
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(view.webContents as any).on('before-input-event', (_event: Event, input: any) => {
      if (!matchesKeyEvent(input, switchShortcut)) return
      const allApps = getMergedWebApps()
      const idx = allApps.findIndex(p => p.key === currentWebAppKey)
      const next = allApps[(idx + 1) % allApps.length]
      if (next.key !== currentWebAppKey) void switchWebApp(next.key)
    })

    view.webContents.on('did-finish-load', () => {
      // 首次创建：加载完成后才挂载（加载期间显示 loading 遮罩，避免白屏卡顿感）
      if (currentWebAppKey === key && !attachedViews.has(key)) {
        attachView(key)
      }
      if (currentWebAppKey === key) {
        getActiveWin()?.webContents?.send('loading', { app: key, status: 'loaded' })
      }
      // 注入 no-drag
      view!.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS failed:', e))
      // 注入通知桥（包装 Notification → postMessage）
      view!.webContents.executeJavaScript(buildNotifyHook()).catch(e => log.error('notify hook inject failed:', e))
      // 主题注入
      const themeDelay = NEEDS_THEME_RELOAD.has(key) ? THEME_INJECT_DELAY_MS : 0
      setTimeout(() => {
        if (view!.webContents && !view!.webContents.isDestroyed()) {
          view!.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(e => log.error('executeJavaScript(theme) failed:', e))
        }
      }, themeDelay)
      // 侧边栏颜色
      if (app.color) {
        const sidebarColor = app.color[currentTheme as keyof typeof app.color] || app.color.dark
        getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
      }
    })

    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      // 跳过正常导航中止
      if (errorCode === -3) return // ERR_ABORTED
      // 本地服务场景：网络类错误 → 拉起后重试一次
      const isNetworkError = errorCode < -100
      if (app.launch && isNetworkError && !launchRetried.has(key)) {
        launchRetried.add(key)
        const healthUrl = app.launch.healthUrl || app.url
        void ensureServiceUp(key, app.launch, healthUrl).then(result => {
          if (result.ok) {
            try {
              if (view!.webContents && !view!.webContents.isDestroyed()) view!.webContents.reload()
            } catch { /* ignore */ }
          }
        })
        return
      }
      destroyBrowserView(key)
      if (currentWebAppKey === key) {
        win.webContents.send('loading', { app: key, status: 'error', error: errorDesc })
      }
    })

    // 渲染进程崩溃恢复
    view.webContents.on('render-process-gone', () => {
      destroyBrowserView(key)
      if (currentWebAppKey === key) {
        win.webContents.send('loading', { app: key, status: 'error', error: 'Renderer crashed' })
      }
    })
  }

  currentWebAppKey = key
  viewLastUsed.set(key, Date.now())
  win.webContents.send('current-webapp-changed', key)
  if (onWebAppSwitched) onWebAppSwitched(key)

  if (view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS(cached) failed:', e))
    if (!isNewlyCreated) {
      // 缓存命中：立即挂载
      attachView(key)
      if (!view.webContents.isLoading()) {
        getActiveWin()?.webContents?.send('loading', { app: key, status: 'loaded' })
      }
    }
    // 首次创建：did-finish-load 时挂载（isLoading 期间显示 loading 遮罩）

    // 侧边栏颜色
    if (app.color) {
      const sidebarColor = app.color[currentTheme as keyof typeof app.color] || app.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }

  // 音频独占：仅当前应用发声
  applyAudioExclusive(key)
  // LRU 裁剪
  pruneViews()
}

// ===== 主题变更 =====
export function handleThemeChange(theme: string, initialAppLoaded: boolean): boolean {
  currentTheme = theme
  if (!initialAppLoaded) {
    void switchWebApp(currentWebAppKey)
    return true
  }
  const view = views.get(currentWebAppKey)
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.executeJavaScript(THEME_SCRIPTS[theme]).then(() => {
      if (NEEDS_THEME_RELOAD.has(currentWebAppKey)) {
        setTimeout(() => {
          if (view.webContents && !view.webContents.isDestroyed()) {
            view.webContents.reload()
          }
        }, THEME_RELOAD_DELAY_MS)
      }
    }).catch(e => log.error('theme executeJavaScript failed:', e))
    // 更新侧边栏颜色
    const app = getMergedWebApps().find(p => p.key === currentWebAppKey)
    if (app?.color) {
      const sidebarColor = app.color[theme as keyof typeof app.color] || app.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }
  return false
}

// ===== 重载当前应用 =====
export function reloadCurrentWebApp(): void {
  const view = views.get(currentWebAppKey)
  if (view && view.webContents && !view.webContents.isDestroyed()) view.webContents.reload()
}

// ===== 获取当前 view =====
export function getCurrentView(): BrowserView | undefined {
  return views.get(currentWebAppKey)
}

// ===== 预置模板（供设置初始化） =====
export function getPresetWebApps(): WebAppInfo[] {
  return PRESET_WEB_APPS
}
