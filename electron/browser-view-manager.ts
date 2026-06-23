// ===== BrowserView 管理模块 =====
// 负责服务商 BrowserView 的创建、切换、销毁和布局更新

import { BrowserView, BrowserWindow, shell } from 'electron'
import log from 'electron-log'
import {
  PROVIDERS,
  NEEDS_THEME_RELOAD,
  SIDEBAR_WIDTH,
  EDGE_WIDTH,
  EDGE_PILL_WIDTH,
  EDGE_PILL_HEIGHT,
  THEME_SCRIPTS,
  buildNotifyBridge,
  CHAT_INPUT_SELECTORS,
  matchesKeyEvent,
  THEME_RELOAD_DELAY_MS,
  THEME_INJECT_DELAY_MS,
  RESIZE_UPDATE_DELAY_MS,
  type Provider
} from './config'
import { generateLetterIcon } from './icons'
import { notifyRenderer } from './notification-bridge'
import type { CustomProvider } from './settings-store'

// ===== 状态 =====
const views = new Map<string, BrowserView>()
let currentProviderKey = 'deepseek'
let enabledProviders: string[] | null = null
let customProviders: CustomProvider[] = []
let providerOrder: string[] | null = null
let currentTheme = 'dark'
let builtInColors: Record<string, { dark: string; light: string }> = {}
let switchShortcut = 'Shift+Tab'
let sidebarCollapsed = false

// ===== 外部回调 =====
let getMainWindow: () => BrowserWindow | null = () => null
let getPopupWindow: () => BrowserWindow | null = () => null
let getActiveWin: () => BrowserWindow | null = () => null
let getMode: () => string = () => 'window'
let onProviderSwitched: ((key: string) => void) | null = null
let createEdgeWindowFn: ((win: BrowserWindow) => void) | null = null
let destroyEdgeWindowFn: () => void = () => {}

// ===== 初始化回调注入 =====
export function initBrowserViewManager(deps: {
  getMainWindow: () => BrowserWindow | null
  getPopupWindow: () => BrowserWindow | null
  getActiveWin: () => BrowserWindow | null
  getMode: () => string
  onProviderSwitched: (key: string) => void
  createEdgeWindow: (win: BrowserWindow) => void
  destroyEdgeWindow: () => void
}): void {
  getMainWindow = deps.getMainWindow
  getPopupWindow = deps.getPopupWindow
  getActiveWin = deps.getActiveWin
  getMode = deps.getMode
  onProviderSwitched = deps.onProviderSwitched
  createEdgeWindowFn = deps.createEdgeWindow
  destroyEdgeWindowFn = deps.destroyEdgeWindow
}

// ===== 状态设置器 =====
export function setEnabledProviders(providers: string[] | null): void { enabledProviders = providers }
export function setCustomProviders(providers: CustomProvider[]): void { customProviders = providers }
export function setProviderOrder(order: string[] | null): void { providerOrder = order }
export function setBuiltInColors(colors: Record<string, { dark: string; light: string }>): void { builtInColors = colors }
export function setSwitchShortcut(shortcut: string): void { switchShortcut = shortcut }
export function setSidebarCollapsed(collapsed: boolean): void { sidebarCollapsed = collapsed }

// ===== 状态获取器 =====
export function getCurrentProviderKey(): string { return currentProviderKey }
export function getViewsMap(): Map<string, BrowserView> { return views }
export function getEnabledProviders(): string[] | null { return enabledProviders }
export function getCustomProvidersList(): CustomProvider[] { return customProviders }
export function getProviderOrderList(): string[] | null { return providerOrder }
export function getBuiltInColors(): Record<string, { dark: string; light: string }> { return builtInColors }

// ===== 合并服务商列表 =====
export function getMergedProviders(): Provider[] {
  const builtIn = (enabledProviders
    ? PROVIDERS.filter(p => enabledProviders!.includes(p.key))
    : [...PROVIDERS]
  ).map(p => ({
    ...p,
    color: builtInColors[p.key] || p.color
  }))
  const custom = customProviders.map(p => ({
    ...p,
    icon: p.icon || generateLetterIcon(p.name),
    color: p.color || { dark: '#1a1e28', light: '#f0f2f5' },
    key: p.key,
    name: p.name,
    url: p.url
  }))
  const merged: Provider[] = [...builtIn, ...custom]
  if (!providerOrder) return merged
  const orderMap = new Map(providerOrder.map((k, i) => [k, i]))
  merged.sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  return merged
}

// ===== 更新 BrowserView 边界 =====
export function updateBrowserViewBounds(): void {
  const view = views.get(currentProviderKey)
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

// ===== 销毁 BrowserView =====
export function destroyBrowserView(key: string): void {
  const view = views.get(key)
  if (view) {
    const win = getActiveWin()
    if (win && !win.isDestroyed()) {
      try {
        win.removeBrowserView(view)
      } catch { /* may already be removed */ }
    }
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
  }
}

// ===== 切换服务商 =====
export function switchProvider(key: string): void {
  // 状态去重：如果已经是当前服务商且 view 存在，跳过
  if (key === currentProviderKey && views.has(key)) return

  const provider = getMergedProviders().find(p => p.key === key)
  if (!provider) return

  const win = getActiveWin()
  if (!win || win.isDestroyed()) return

  // 隐藏当前 view
  const prevView = views.get(currentProviderKey)
  if (prevView && prevView.webContents && !prevView.webContents.isDestroyed()) {
    try { win.removeBrowserView(prevView) } catch { /* may already be removed */ }
  }

  // 获取或创建目标 view
  let view = views.get(key)
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
    views.set(key, view)

    // 安全：外链在浏览器中打开
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    view.webContents.loadURL(provider.url)
    notifyRenderer(getMainWindow(), getPopupWindow(), 'loading', { provider: key, status: 'loading' })

    // 切换服务商快捷键
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(view.webContents as any).on('before-input-event', (_event: Event, input: any) => {
      if (!matchesKeyEvent(input, switchShortcut)) return
      const allProviders = getMergedProviders()
      const idx = allProviders.findIndex(p => p.key === currentProviderKey)
      const next = allProviders[(idx + 1) % allProviders.length]
      if (next.key !== currentProviderKey) switchProvider(next.key)
    })

    view.webContents.on('did-finish-load', () => {
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
      }
      // 注入 no-drag
      view!.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS failed:', e))
      // 注入通知桥接
      view!.webContents.executeJavaScript(buildNotifyBridge(provider.key, provider.icon)).catch(e => log.error('notify bridge inject failed:', e))
      // 主题注入
      const themeDelay = NEEDS_THEME_RELOAD.has(key) ? THEME_INJECT_DELAY_MS : 0
      setTimeout(() => {
        if (view!.webContents && !view!.webContents.isDestroyed()) {
          view!.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(e => log.error('executeJavaScript(theme) failed:', e))
        }
      }, themeDelay)
      // 侧边栏颜色
      if (provider.color) {
        const sidebarColor = provider.color[currentTheme as keyof typeof provider.color] || provider.color.dark
        getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
      }
    })

    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      // 跳过正常导航中止
      if (errorCode === -3) return // ERR_ABORTED
      destroyBrowserView(key)
      if (currentProviderKey === key) {
        win.webContents.send('loading', { provider: key, status: 'error', error: errorDesc })
      }
    })

    // 渲染进程崩溃恢复
    view.webContents.on('render-process-gone', () => {
      destroyBrowserView(key)
      if (currentProviderKey === key) {
        win.webContents.send('loading', { provider: key, status: 'error', error: 'Renderer crashed' })
      }
    })
  }

  currentProviderKey = key
  win.webContents.send('current-provider-changed', key)
  if (onProviderSwitched) onProviderSwitched(key)

  if (view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS(cached) failed:', e))
    win.addBrowserView(view)
    updateBrowserViewBounds()

    if (!view.webContents.isLoading()) {
      getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
    }

    // 侧边栏颜色
    if (provider.color) {
      const sidebarColor = provider.color[currentTheme as keyof typeof provider.color] || provider.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }
}

// ===== 主题变更 =====
export function handleThemeChange(theme: string, initialProviderLoaded: boolean): boolean {
  currentTheme = theme
  if (!initialProviderLoaded) {
    switchProvider(currentProviderKey)
    return true
  }
  const view = views.get(currentProviderKey)
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.executeJavaScript(THEME_SCRIPTS[theme]).then(() => {
      if (NEEDS_THEME_RELOAD.has(currentProviderKey)) {
        setTimeout(() => {
          if (view.webContents && !view.webContents.isDestroyed()) {
            view.webContents.reload()
          }
        }, THEME_RELOAD_DELAY_MS)
      }
    }).catch(e => log.error('theme executeJavaScript failed:', e))
    // 更新侧边栏颜色
    const provider = getMergedProviders().find(p => p.key === currentProviderKey)
    if (provider?.color) {
      const sidebarColor = provider.color[theme as keyof typeof provider.color] || provider.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }
  return false
}

// ===== 重载当前服务商 =====
export function reloadCurrentProvider(): void {
  const view = views.get(currentProviderKey)
  if (view && view.webContents && !view.webContents.isDestroyed()) view.webContents.reload()
}

// ===== 剪贴板注入 =====
export async function injectClipboard(clipboardText: string): Promise<{ ok: boolean; error?: string }> {
  if (!clipboardText) return { ok: false, error: '剪贴板为空' }
  const view = views.get(currentProviderKey)
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return { ok: false, error: '服务商未加载' }
  }
  // 校验当前 view origin
  const provider = getMergedProviders().find(p => p.key === currentProviderKey)
  if (provider) {
    try {
      const currentUrl = view.webContents.getURL()
      const viewOrigin = new URL(currentUrl).origin
      const expectedOrigin = new URL(provider.url).origin
      if (viewOrigin !== expectedOrigin) {
        return { ok: false, error: '当前页面与服务商不匹配，拒绝注入' }
      }
    } catch {
      return { ok: false, error: '无法校验页面来源' }
    }
  }

  const selector = CHAT_INPUT_SELECTORS[currentProviderKey] || 'textarea, div[contenteditable="true"]'
  const safeText = JSON.stringify(clipboardText)
  try {
    await view.webContents.executeJavaScript(`
      (function() {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        var text = ${safeText};
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.textContent = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      })()
    `)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '注入失败：' + (e as Error).message }
  }
}

// ===== 获取当前 view =====
export function getCurrentView(): BrowserView | undefined {
  return views.get(currentProviderKey)
}
