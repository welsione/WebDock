import { app, BrowserWindow, BrowserView, ipcMain, Menu, screen, nativeTheme, globalShortcut, shell, clipboard, Notification, session, webContents } from 'electron'
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import {
  PROVIDERS,
  NEEDS_THEME_RELOAD,
  MODE,
  THEME,
  SIDEBAR_WIDTH,
  EDGE_WIDTH,
  EDGE_PILL_WIDTH,
  EDGE_PILL_HEIGHT,
  POPUP_WIDTH,
  POPUP_HEIGHT,
  THEME_SCRIPTS,
  NOTIFY_BRIDGE,
  CHAT_INPUT_SELECTORS,
  matchesKeyEvent,
  Provider
} from './config'
import { APP_ICON, fetchFavicon, fetchIconByUrl, generateLetterIcon, dataUrlToNativeImage, writeIconToTempFile } from './icons'

// ===== Types =====
interface CustomProvider {
  key: string
  name: string
  url: string
  icon?: string
  color?: { dark: string; light: string }
}

interface Settings {
  shortcut?: string
  switchShortcut?: string
  mode?: string
  enabledProviders?: string[] | null
  customProviders?: CustomProvider[]
  providerOrder?: string[] | null
  windowBounds?: { x: number; y: number; width: number; height: number } | null
  builtInColors?: Record<string, { dark: string; light: string }>
}

// ===== State =====
let mainWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null
// let tray: Tray | null = null // 暂不启用托盘菜单
const views = new Map<string, BrowserView>() // providerKey -> BrowserView 缓存，切换不销毁
let currentProviderKey = 'deepseek'
let enabledProviders: string[] | null = null // null = 全部内置启用
let customProviders: CustomProvider[] = [] // [{key, name, url}]
let providerOrder: string[] | null = null // null = 默认顺序，否则为 key 数组
let mode: string = MODE.WINDOW
let SIDEBAR_COLLAPSED = false
let edgeWindow: BrowserWindow | null = null
let currentTheme: string = THEME.DARK
let initialProviderLoaded = false
let currentShortcut = 'Cmd+Shift+Space'
let switchShortcut = 'Shift+Tab'
let savedBounds: { x: number; y: number; width: number; height: number } | null = null
let builtInColors: Record<string, { dark: string; light: string }> = {}

// ===== Settings Persistence =====
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

function loadSettings(): Settings | null {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch (e) { log.error('Failed to load settings:', e) }
  return null
}

function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getBounds()
  savedBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  saveSettings()
}

function saveSettings(): void {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({
      shortcut: currentShortcut,
      switchShortcut,
      mode,
      enabledProviders,
      customProviders,
      providerOrder,
      windowBounds: savedBounds,
      builtInColors
    }))
  } catch (e) { log.error('Failed to save settings:', e) }
}

// ===== Native Notification =====
function showNativeNotification(title: string, body: string, iconDataUrl?: string, providerKey?: string): void {
  if (!Notification.isSupported()) return
  const options: Electron.NotificationConstructorOptions = { title, body }
  if (iconDataUrl) {
    const img = dataUrlToNativeImage(iconDataUrl)
    if (img) {
      options.icon = process.platform === 'darwin' ? writeIconToTempFile(img) ?? img : img
    }
  }
  const n = new Notification(options)
  n.on('click', () => {
    if (providerKey && providerKey !== currentProviderKey) {
      switchProvider(providerKey)
    }
    showMainWindow()
  })
  n.show()
}

// 当图标无法被正常解析时，生成纯色方块作为最后回退
// 根据 webContents 查找对应服务商的 key 和图标
function findProviderByWebContents(wc: Electron.WebContents): { key: string; icon: string } | null {
  for (const [key, view] of views) {
    if (view?.webContents?.id === wc.id) {
      const merged = getMergedProviders()
      const p = merged.find(x => x.key === key)
      return p ? { key: p.key, icon: p.icon } : null
    }
  }
  return null
}

// 根据 webContents 查找对应服务商的图标
function findProviderIcon(wc: Electron.WebContents): string | undefined {
  return findProviderByWebContents(wc)?.icon
}

// ===== Notification Bridge =====
// 监听所有 BrowserView 的 console.log 消息，拦截页面内 Notification 调用
function setupNotificationBridge(): void {
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

function setupWebContentsNotificationListener(wc: Electron.WebContents): void {
  if ((wc as unknown as Record<string, unknown>)._notifyListened) return
  ;(wc as unknown as Record<string, unknown>)._notifyListened = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(wc as any).on('console-message', (_event: Electron.Event, details: Electron.WebContentsConsoleMessageEventParams) => {
    const message = details.message
    if (!message || !message.startsWith('__MINEAI_NOTIFY__:')) return
    try {
      const data = JSON.parse(message.slice('__MINEAI_NOTIFY__:'.length))
      if (data.title) {
        const info = findProviderByWebContents(wc)
        showNativeNotification(data.title, data.body || '', info?.icon, info?.key)
      }
    } catch { /* ignore malformed notify message */ }
  })
}

// ===== Helpers =====
function getActiveWin(): BrowserWindow | null {
  return mode === MODE.MENUBAR ? popupWindow : mainWindow
}

// 获取合并后的服务商列表（内置已启用 + 自定义）
function getMergedProviders(): Provider[] {
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
  // 按 providerOrder 排序，未在 order 中的排到末尾
  const orderMap = new Map(providerOrder.map((k, i) => [k, i]))
  merged.sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  return merged
}

// 全局快捷键触发的 toggle 逻辑，两处调用复用
function toggleWindowVisibility(): void {
  const win = mainWindow
  if (!win) { showMainWindow(); return }
  if (win.isVisible() && (mode === MODE.WINDOW || (popupWindow && popupWindow.isVisible()))) {
    if (mode === MODE.MENUBAR && popupWindow) popupWindow.hide()
    else win.hide()
  } else {
    showMainWindow()
  }
}

// ===== Global Shortcut =====
function registerGlobalShortcut(acc: string): void {
  globalShortcut.unregisterAll()
  if (!acc) return
  const registered = globalShortcut.register(acc, toggleWindowVisibility)
  if (!registered) log.error('Failed to register global shortcut:', acc)
}

// ===== App Ready =====
app.whenReady().then(() => {
  // 加载持久化设置
  const settings = loadSettings()
  if (settings) {
    if (settings.shortcut) currentShortcut = settings.shortcut
    if (settings.switchShortcut) switchShortcut = settings.switchShortcut
    if (settings.enabledProviders !== undefined) enabledProviders = settings.enabledProviders
    if (settings.customProviders) customProviders = settings.customProviders
    if (settings.providerOrder) providerOrder = settings.providerOrder
    if (settings.windowBounds) savedBounds = settings.windowBounds
    if (settings.builtInColors) builtInColors = settings.builtInColors
  }

  // createTray() // 暂不启用托盘菜单
  setupNotificationBridge()
  setupIPC()
  createMainWindow()
  setupMenu()
  registerGlobalShortcut(currentShortcut)

  // 自动更新（仅在打包后生效）
  if (app.isPackaged) {
    setupAutoUpdater()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// ===== Auto Updater =====
let updateInfo: UpdateInfo | null = null

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateInfo = info
    notifyRenderer('update-status', { status: 'available', version: info.version })
    showNativeNotification('发现新版本', `MineAI Hub v${info.version} 可用，点击下载更新`, APP_ICON)
  })

  autoUpdater.on('update-not-available', () => {
    notifyRenderer('update-status', { status: 'none' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    notifyRenderer('update-status', { status: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    notifyRenderer('update-status', { status: 'downloaded' })
    showNativeNotification('更新已就绪', 'MineAI Hub 更新已下载完成，重启即可安装', APP_ICON)
  })

  autoUpdater.on('error', (err: Error) => {
    notifyRenderer('update-status', { status: 'error', error: err.message })
  })

  // 启动后延迟检查更新
  setTimeout(() => autoUpdater.checkForUpdates().catch(e => log.error('checkForUpdates failed:', e)), 5000)
}

function notifyRenderer(channel: string, data: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send(channel, data)
  }
}

// ===== Validate Bounds =====
function isValidBounds(bounds: { x: number; y: number; width: number; height: number } | null): boolean {
  if (!bounds) return false
  const displays = screen.getAllDisplays()
  return displays.some(d => {
    const { x, y, width, height } = d.workArea
    return bounds.x >= x - bounds.width + 100 &&
           bounds.x <= x + width - 100 &&
           bounds.y >= y &&
           bounds.y <= y + height - 100
  })
}

// ===== Create Main Window =====
function createMainWindow(): void {
  const defaultBounds = { width: 1000, height: 700 }
  const bounds = isValidBounds(savedBounds)
    ? { ...savedBounds!, minWidth: 600, minHeight: 400 }
    : { ...defaultBounds, minWidth: 600, minHeight: 400 }

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 8, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // electron-vite: 开发模式下使用 dev server URL，生产模式用文件
  if (import.meta.env.DEV) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', () => {
    if (mode === MODE.WINDOW) {
      mainWindow!.show()
    }
  })

  // 窗口大小变化时更新 BrowserView
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  mainWindow.on('resize', () => {
    if (resizeTimer) return
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      updateBrowserViewBounds()
    }, 16)
  })

  // 窗口移动/调整大小时延迟保存位置到磁盘
  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleBoundsSave = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      saveWindowBounds()
    }, 500)
  }
  mainWindow.on('resize', scheduleBoundsSave)
  mainWindow.on('move', scheduleBoundsSave)

  mainWindow.on('close', (e) => {
    if (mode === MODE.MENUBAR) {
      e.preventDefault()
      mainWindow!.hide()
    } else {
      destroyEdgeWindow()
    }
  })

  mainWindow.on('closed', () => {
    destroyEdgeWindow()
    mainWindow = null
  })
}

// ===== Create Tray (暂不启用，后续如需托盘菜单取消注释) =====
// function createTray(): void {
//   const iconPath = path.join(__dirname, '../assets/tray-icon.png')
//   const icon = nativeImage.createFromPath(iconPath)
//
//   tray = new Tray(icon.resize({ width: 18, height: 18 }))
//   tray.setToolTip('MineAI Hub')
//
//   tray.setContextMenu(buildTrayMenu())
//
//   tray.on('click', () => {
//     if (mode === MODE.MENUBAR) {
//       togglePopup()
//     } else {
//       showMainWindow()
//     }
//   })
// }
//
// function buildTrayMenu(): Menu {
//   return Menu.buildFromTemplate([
//     { label: '显示窗口', click: () => showMainWindow() },
//     { type: 'separator' },
//     { label: '退出', click: () => app.quit() }
//   ])
// }
//
// function updateTrayMenu(): void {
//   tray!.setContextMenu(buildTrayMenu())
// }

// ===== Create Popup Window (Menubar Mode) =====
function createPopupWindow(): BrowserWindow {
  if (popupWindow) return popupWindow

  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // electron-vite: 开发模式下使用 dev server URL，生产模式用文件
  if (import.meta.env.DEV) {
    popupWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    popupWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  popupWindow.on('blur', () => {
    if (popupWindow && popupWindow.isVisible()) {
      popupWindow.hide()
    }
  })

  popupWindow.on('closed', () => {
    popupWindow = null
  })

  return popupWindow
}

function togglePopup(): void {
  if (!popupWindow) {
    createPopupWindow()
  }

  if (popupWindow!.isVisible()) {
    popupWindow!.hide()
  } else {
    positionPopup()
    popupWindow!.show()
    popupWindow!.focus()

    if (!views.has(currentProviderKey)) {
      switchProvider(currentProviderKey)
    }
  }
}

function positionPopup(): void {
  // tray is not used yet, function kept for future use
}

// ===== Show Main Window =====
function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow()
  }
  mainWindow!.show()
  mainWindow!.focus()

  if (!views.has(currentProviderKey)) {
    switchProvider(currentProviderKey)
  }
}

// ===== Set Mode =====
function setMode(newMode: string): void {
  mode = newMode

  if (newMode === MODE.WINDOW) {
    showMainWindow()
    if (popupWindow) popupWindow.hide()
  } else {
    if (mainWindow) mainWindow.hide()
  }

  if (mainWindow) mainWindow.webContents.send('mode-changed', mode)
  if (popupWindow) popupWindow.webContents.send('mode-changed', mode)
}

// ===== Update BrowserView Bounds =====
function updateBrowserViewBounds(): void {
  const view = views.get(currentProviderKey)
  if (!view || view.webContents?.isDestroyed()) return

  const win = getActiveWin()
  if (!win) return

  const contentBounds = win.getContentBounds()
  const effectiveSidebarWidth = SIDEBAR_COLLAPSED ? EDGE_WIDTH : SIDEBAR_WIDTH

  view.setBounds({
    x: effectiveSidebarWidth,
    y: Math.max(0, contentBounds.y - win.getBounds().y),
    width: contentBounds.width - effectiveSidebarWidth,
    height: contentBounds.height
  })

  if (SIDEBAR_COLLAPSED) {
    createEdgeWindow(win)
  } else {
    destroyEdgeWindow()
  }
}

// 创建边缘条窗口
function createEdgeWindow(parentWin: BrowserWindow): void {
  if (edgeWindow) return

  const contentBounds = parentWin.getContentBounds()
  const pillY = contentBounds.y + Math.round((contentBounds.height - EDGE_PILL_HEIGHT) / 2)

  edgeWindow = new BrowserWindow({
    width: EDGE_PILL_WIDTH,
    height: EDGE_PILL_HEIGHT,
    x: contentBounds.x,
    y: pillY,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    parent: parentWin,
    webPreferences: {
      preload: path.join(__dirname, '../preload/edge.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const edgeQuery = `theme=${currentTheme}`

  // electron-vite: 开发模式下使用 dev server URL，生产模式用文件
  if (import.meta.env.DEV) {
    edgeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL!}/edge.html?${edgeQuery}`)
  } else {
    edgeWindow.loadFile(path.join(__dirname, '../renderer/edge.html'), {
      query: { theme: currentTheme }
    })
  }

  let edgeMoveTimer: ReturnType<typeof setTimeout> | null = null
  const updateEdge = () => {
    if (edgeMoveTimer) return
    edgeMoveTimer = setTimeout(() => {
      edgeMoveTimer = null
      if (!edgeWindow) return
      updateEdgeWindowPosition()
    }, 16)
  }
  parentWin.on('move', updateEdge)
  parentWin.on('resize', updateEdge)
  ;(edgeWindow as unknown as Record<string, unknown>)._cleanup = () => {
    parentWin.removeListener('move', updateEdge)
    parentWin.removeListener('resize', updateEdge)
  }
}

function updateEdgeWindowPosition(): void {
  if (!edgeWindow) return

  const parentWin = getActiveWin()
  if (!parentWin) return

  const contentBounds = parentWin.getContentBounds()
  const pillY = contentBounds.y + Math.round((contentBounds.height - EDGE_PILL_HEIGHT) / 2)

  edgeWindow.setPosition(contentBounds.x, pillY)
}

function destroyEdgeWindow(): void {
  if (edgeWindow) {
    const win = edgeWindow as unknown as Record<string, unknown>
    if (typeof (win._cleanup) === 'function') (win._cleanup as () => void)()
    edgeWindow.close()
    edgeWindow = null
  }
}

// ===== Switch Provider (BrowserView 缓存，切换不销毁) =====
function switchProvider(key: string): void {
  const provider = getMergedProviders().find(p => p.key === key)
  if (!provider) return

  const win = getActiveWin()
  if (!win) return

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

    // 安全：外链在浏览器中打开，不在应用内开新窗口
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    view.webContents.loadURL(provider.url)
    getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loading' })

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
      // 注入 no-drag，确保 BrowserView 内容可点击
      view!.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS failed:', e))
      // 注入通知拦截脚本（聚合页面内 Notification 到原生通知）
      view!.webContents.executeJavaScript(NOTIFY_BRIDGE).catch(e => log.error('notify bridge inject failed:', e))
      // 对需要重载的服务商延迟注入主题，等页面 JS 初始化完成读取 localStorage
      const themeDelay = NEEDS_THEME_RELOAD.has(key) ? 300 : 0
      setTimeout(() => {
        if (view!.webContents && !view!.webContents.isDestroyed()) {
          view!.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(e => log.error('executeJavaScript(theme) failed:', e))
        }
      }, themeDelay)
      // 页面加载完成后发送侧边栏颜色
      if (provider.color) {
        const sidebarColor = provider.color[currentTheme as keyof typeof provider.color] || provider.color.dark
        getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
      }
    })

    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      // 清除死 view，下次切换时重建
      views.delete(key)
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'error', error: errorDesc })
        showNativeNotification(`${provider.name} 加载失败`, errorDesc, provider.icon, key)
      }
    })

    // 渲染进程崩溃恢复
    view.webContents.on('render-process-gone', () => {
      views.delete(key)
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'error', error: 'Renderer crashed' })
      }
    })
  }

  currentProviderKey = key
  getActiveWin()?.webContents?.send('current-provider-changed', key)
  if (view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(e => log.error('insertCSS(cached) failed:', e))
    win.addBrowserView(view)
    updateBrowserViewBounds()

    if (!view.webContents.isLoading()) {
      getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
    }

    // 发送侧边栏颜色
    if (provider.color) {
      const sidebarColor = provider.color[currentTheme as keyof typeof provider.color] || provider.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }
}

// ===== Setup IPC =====
function setupIPC(): void {
  ipcMain.on('switch-provider', (_event, key: string) => {
    switchProvider(key)
  })

  ipcMain.on('reload', () => {
    const view = views.get(currentProviderKey)
    if (view && view.webContents && !view.webContents.isDestroyed()) view.webContents.reload()
  })

  ipcMain.handle('toggle-mode', () => {
    setMode(mode === MODE.WINDOW ? MODE.MENUBAR : MODE.WINDOW)
    return mode
  })

  ipcMain.handle('get-mode', () => mode)
  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('get-current-provider', () => currentProviderKey)
  ipcMain.handle('get-providers', () => getMergedProviders())

  // 服务商管理
  ipcMain.handle('get-provider-settings', () => ({
    builtIn: PROVIDERS.map(p => ({ key: p.key, name: p.name, url: p.url, icon: p.icon, color: builtInColors[p.key] || p.color })),
    enabled: enabledProviders,
    custom: customProviders,
    order: providerOrder
  }))
  ipcMain.handle('save-provider-settings', (_event, settings: { enabled: string[] | null; custom: CustomProvider[]; builtInColors?: Record<string, { dark: string; light: string }> }) => {
    enabledProviders = settings.enabled
    customProviders = settings.custom || []
    if (settings.builtInColors) {
      builtInColors = settings.builtInColors
    }
    saveSettings()
    // 通知渲染进程刷新服务商列表
    if (mainWindow) mainWindow.webContents.send('providers-updated', getMergedProviders())
    if (popupWindow) popupWindow.webContents.send('providers-updated', getMergedProviders())
  })

  ipcMain.handle('save-provider-order', (_event, order: string[]) => {
    providerOrder = order
    saveSettings()
    if (mainWindow) mainWindow.webContents.send('providers-updated', getMergedProviders())
    if (popupWindow) popupWindow.webContents.send('providers-updated', getMergedProviders())
  })

  ipcMain.on('sidebar-state', (_event, collapsed: boolean) => {
    SIDEBAR_COLLAPSED = collapsed
    const win = getActiveWin()
    if (win && !win.isDestroyed()) {
      win.setWindowButtonVisibility(!collapsed)
    }
    updateBrowserViewBounds()
  })

  ipcMain.on('exit-focus', () => {
    SIDEBAR_COLLAPSED = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setWindowButtonVisibility(true)
    }
    destroyEdgeWindow()
    updateBrowserViewBounds()
    if (mainWindow) mainWindow.webContents.send('exit-focus-mode')
    if (popupWindow) popupWindow.webContents.send('exit-focus-mode')
  })

  ipcMain.on('toggle-settings', (_event, show: boolean) => {
    const view = views.get(currentProviderKey)
    const win = getActiveWin()
    if (!view || !win || view.webContents?.isDestroyed()) return
    if (show) {
      try { win.removeBrowserView(view) } catch { /* may already be removed */ }
    } else {
      win.addBrowserView(view)
      updateBrowserViewBounds()
    }
  })

  ipcMain.handle('get-shortcut', () => currentShortcut)
  ipcMain.handle('set-shortcut', (_event, acc: string) => {
    if (!acc) {
      globalShortcut.unregisterAll()
      currentShortcut = ''
      saveSettings()
      return { ok: true }
    }
    // 尝试注册新快捷键，检测冲突
    globalShortcut.unregisterAll()
    const registered = globalShortcut.register(acc, toggleWindowVisibility)
    if (registered) {
      currentShortcut = acc
      saveSettings()
      return { ok: true }
    }
    // 注册失败，恢复旧快捷键
    if (currentShortcut) {
      globalShortcut.register(currentShortcut, toggleWindowVisibility)
    }
    return { ok: false, error: '快捷键被占用或无效，请尝试其他组合' }
  })

  ipcMain.handle('get-switch-shortcut', () => switchShortcut)
  ipcMain.handle('set-switch-shortcut', (_event, acc: string) => {
    if (acc && acc === currentShortcut) {
      return { ok: false, error: '与全局快捷键冲突，请选择其他组合' }
    }
    switchShortcut = acc || 'Shift+Tab'
    saveSettings()
    return { ok: true }
  })

  // 获取网站 favicon
  ipcMain.handle('fetch-favicon', async (_event, url: string) => {
    return await fetchFavicon(url)
  })

  // 从 URL 获取图标（供设置页手动输入图标网址使用）
  ipcMain.handle('fetch-icon-url', async (_event, iconUrl: string) => {
    return await fetchIconByUrl(iconUrl)
  })

  // 剪贴板注入：将剪贴板内容粘贴到当前服务商的输入框
  ipcMain.handle('inject-clipboard', async () => {
    const text = clipboard.readText()
    if (!text) return { ok: false, error: '剪贴板为空' }
    const view = views.get(currentProviderKey)
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { ok: false, error: '服务商未加载' }
    }
    const selector = CHAT_INPUT_SELECTORS[currentProviderKey] || 'textarea, div[contenteditable="true"]'
    try {
      await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('${selector}');
          if (!el) return false;
          el.focus();
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            el.textContent = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        })()
      `)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: '注入失败：' + (e as Error).message }
    }
  })

  ipcMain.on('move-window', (_event, dx: number, dy: number) => {
    const win = getActiveWin()
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  ipcMain.on('theme-changed', (_event, theme: string) => {
    if (theme === currentTheme && initialProviderLoaded) return
    currentTheme = theme
    nativeTheme.themeSource = theme as typeof nativeTheme.themeSource
    if (edgeWindow) {
      edgeWindow.webContents.send('edge-theme-changed', theme)
    }
    if (!initialProviderLoaded) {
      initialProviderLoaded = true
      switchProvider(currentProviderKey)
      return
    }
    const view = views.get(currentProviderKey)
    if (view && view.webContents && !view.webContents?.isDestroyed()) {
      view.webContents.executeJavaScript(THEME_SCRIPTS[theme]).then(() => {
        if (NEEDS_THEME_RELOAD.has(currentProviderKey)) {
          // 延迟刷新，确保 localStorage 已写入
          setTimeout(() => {
            if (view.webContents && !view.webContents.isDestroyed()) {
              view.webContents.reload()
            }
          }, 100)
        }
      }).catch(e => log.error('theme executeJavaScript failed:', e))
      // 主题切换后更新侧边栏颜色
      const provider = getMergedProviders().find(p => p.key === currentProviderKey)
      if (provider?.color) {
        const sidebarColor = provider.color[theme as keyof typeof provider.color] || provider.color.dark
        getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
      }
    }
  })

  // 自动更新
  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) return { ok: false, error: '开发模式不支持更新' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, hasUpdate: !!result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) return { ok: false }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('install-update', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })
}

// ===== Setup Menu =====
function setupMenu(): void {
  const isDev = !app.isPackaged
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'MineAI Hub',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    ...(isDev ? [{
      label: '开发',
      submenu: [
        {
          label: '打开 BrowserView DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const view = views.get(currentProviderKey)
            if (view?.webContents && !view.webContents.isDestroyed()) {
              view.webContents.openDevTools({ mode: 'detach' })
            }
          }
        },
        {
          label: '打开主窗口 DevTools',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.openDevTools({ mode: 'detach' })
            }
          }
        },
        { type: 'separator' },
        {
          label: '发送测试通知 (当前服务商)',
          click: () => {
            const p = getMergedProviders().find(x => x.key === currentProviderKey)
            if (p) {
              showNativeNotification(`${p.name} — 测试通知`, '来自 MineAI 的测试消息', p.icon, p.key)
            }
          }
        }
      ]
    } as Electron.MenuItemConstructorOptions] : [])
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ===== App Events =====
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mode === MODE.WINDOW) {
    showMainWindow()
  }
})

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'window') return
  ;(contents as any).on('will-navigate', (navEvent: Event & { preventDefault: () => void }, url: string) => {
    if (url && url.startsWith('file://')) {
      navEvent.preventDefault()
    }
  })
})
