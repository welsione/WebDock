const { app, BrowserWindow, BrowserView, ipcMain, Menu, screen, nativeTheme, globalShortcut, shell, clipboard } = require('electron')
const { autoUpdater } = require('electron-updater')
// Tray, nativeImage — 暂不启用托盘菜单，后续如需启用取消注释
// const { Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const {
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
  CHAT_INPUT_SELECTORS,
  matchesKeyEvent
} = require('./config')

// ===== State =====
let mainWindow = null
let popupWindow = null
// let tray = null // 暂不启用托盘菜单
const views = new Map() // providerKey -> BrowserView 缓存，切换不销毁
let currentProviderKey = 'deepseek'
let enabledProviders = null // null = 全部内置启用
let customProviders = [] // [{key, name, url}]
let providerOrder = null // null = 默认顺序，否则为 key 数组
let mode = MODE.WINDOW
let SIDEBAR_COLLAPSED = false
let edgeWindow = null
let currentTheme = THEME.DARK
let initialProviderLoaded = false
let currentShortcut = 'Cmd+Shift+Space'
let switchShortcut = 'Shift+Tab'
let savedBounds = null // {x, y, width, height}
let builtInColors = {} // { providerKey: { dark, light } }

// ===== Settings Persistence =====
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch (e) {}
  return null
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getBounds()
  savedBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  saveSettings()
}

function saveSettings() {
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
  } catch (e) {}
}

// ===== Helpers =====
function getActiveWin() {
  return mode === MODE.MENUBAR ? popupWindow : mainWindow
}

// 获取合并后的服务商列表（内置已启用 + 自定义）
function getMergedProviders() {
  const builtIn = (enabledProviders
    ? PROVIDERS.filter(p => enabledProviders.includes(p.key))
    : [...PROVIDERS]
  ).map(p => ({
    ...p,
    color: builtInColors[p.key] || p.color
  }))
  const custom = customProviders.map(p => ({
    ...p,
    icon: p.icon || generateLetterIcon(p.name),
    color: p.color || { dark: '#1a1e28', light: '#f0f2f5' }
  }))
  const merged = [...builtIn, ...custom]
  if (!providerOrder) return merged
  // 按 providerOrder 排序，未在 order 中的排到末尾
  const orderMap = new Map(providerOrder.map((k, i) => [k, i]))
  merged.sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  return merged
}

// 为自定义服务商生成首字母图标
function generateLetterIcon(name) {
  const letter = (name || '?').charAt(0).toUpperCase()
  const colors = ['#5eead4','#f472b6','#a78bfa','#fb923c','#38bdf8','#4ade80','#facc15','#f87171']
  const color = colors[letter.charCodeAt(0) % colors.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="${color}"/><text x="24" y="32" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" font-family="-apple-system,sans-serif">${letter}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// 尝试单个 URL 获取图标
function tryFetchIcon(iconUrl) {
  return new Promise((resolve) => {
    try {
      const { net } = require('electron')
      const request = net.request(iconUrl)
      request.on('response', (response) => {
        if (response.statusCode !== 200) { resolve(null); return }
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (buf.length < 100) { resolve(null); return }
          const mime = response.headers['content-type']?.[0] || 'image/x-icon'
          resolve(`data:${mime};base64,${buf.toString('base64')}`)
        })
      })
      request.on('error', () => resolve(null))
      setTimeout(() => { try { request.abort() } catch(e){}; resolve(null) }, 3000)
    } catch { resolve(null) }
  })
}

// 获取网站 favicon，依次尝试多个常见路径
async function fetchFavicon(siteUrl) {
  const origin = new URL(siteUrl).origin
  const candidates = [
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
  ]
  for (const url of candidates) {
    const icon = await tryFetchIcon(url)
    if (icon) return icon
  }
  return null
}

// 全局快捷键触发的 toggle 逻辑，两处调用复用
function toggleWindowVisibility() {
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
function registerGlobalShortcut(acc) {
  globalShortcut.unregisterAll()
  if (!acc) return
  const registered = globalShortcut.register(acc, toggleWindowVisibility)
  if (!registered) console.error('Failed to register global shortcut:', acc)
}

// ===== App Ready =====
app.whenReady().then(() => {
  // 加载持久化设置
  const settings = loadSettings()
  if (settings) {
    if (settings.shortcut) currentShortcut = settings.shortcut
    if (settings.switchShortcut) switchShortcut = settings.switchShortcut
    if (settings.enabledProviders) enabledProviders = settings.enabledProviders
    if (settings.customProviders) customProviders = settings.customProviders
    if (settings.providerOrder) providerOrder = settings.providerOrder
    if (settings.windowBounds) savedBounds = settings.windowBounds
    if (settings.builtInColors) builtInColors = settings.builtInColors
  }

  // createTray() // 暂不启用托盘菜单
  createMainWindow()
  setupIPC()
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
let updateInfo = null

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    updateInfo = info
    notifyRenderer('update-status', { status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    notifyRenderer('update-status', { status: 'none' })
  })

  autoUpdater.on('download-progress', (progress) => {
    notifyRenderer('update-status', { status: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    notifyRenderer('update-status', { status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    notifyRenderer('update-status', { status: 'error', error: err.message })
  })

  // 启动后延迟检查更新
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
}

function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send(channel, data)
  }
}

// ===== Validate Bounds =====
function isValidBounds(bounds) {
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
function createMainWindow() {
  const defaultBounds = { width: 1000, height: 700 }
  const bounds = isValidBounds(savedBounds)
    ? { ...savedBounds, minWidth: 600, minHeight: 400 }
    : { ...defaultBounds, minWidth: 600, minHeight: 400 }

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 8, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'))

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', () => {
    if (mode === MODE.WINDOW) {
      mainWindow.show()
    }
  })

  // 窗口大小变化时更新 BrowserView
  let resizeTimer = null
  mainWindow.on('resize', () => {
    if (resizeTimer) return
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      updateBrowserViewBounds()
    }, 16)
  })

  // 窗口移动/调整大小时延迟保存位置到磁盘
  let boundsSaveTimer = null
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
      mainWindow.hide()
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
// function createTray() {
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
// function buildTrayMenu() {
//   return Menu.buildFromTemplate([
//     { label: '显示窗口', click: () => showMainWindow() },
//     { type: 'separator' },
//     { label: '退出', click: () => app.quit() }
//   ])
// }
//
// function updateTrayMenu() {
//   tray.setContextMenu(buildTrayMenu())
// }

// ===== Create Popup Window (Menubar Mode) =====
function createPopupWindow() {
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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  popupWindow.loadFile(path.join(__dirname, '../src/index.html'))

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

function togglePopup() {
  if (!popupWindow) {
    createPopupWindow()
  }

  if (popupWindow.isVisible()) {
    popupWindow.hide()
  } else {
    positionPopup()
    popupWindow.show()
    popupWindow.focus()

    if (!views.has(currentProviderKey)) {
      switchProvider(currentProviderKey)
    }
  }
}

function positionPopup() {
  if (!tray || !popupWindow) return

  const trayBounds = tray.getBounds()
  const popupWidth = POPUP_WIDTH

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - popupWidth / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + 4)

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  const workArea = display.workArea

  if (x < workArea.x) x = workArea.x
  if (x + popupWidth > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - popupWidth
  }

  popupWindow.setPosition(x, y)
}

// ===== Show Main Window =====
function showMainWindow() {
  if (!mainWindow) {
    createMainWindow()
  }
  mainWindow.show()
  mainWindow.focus()

  if (!views.has(currentProviderKey)) {
    switchProvider(currentProviderKey)
  }
}

// ===== Set Mode =====
function setMode(newMode) {
  mode = newMode

  if (newMode === MODE.WINDOW) {
    showMainWindow()
    if (popupWindow) popupWindow.hide()
  } else {
    if (mainWindow) mainWindow.hide()
  }

  if (mainWindow) mainWindow.webContents.send('mode-changed', mode)
  if (popupWindow) popupWindow.webContents.send('mode-changed', mode)

  // updateTrayMenu() // 暂不启用托盘菜单
}

// function buildTrayMenu() { // 暂不启用托盘菜单
//   return Menu.buildFromTemplate([
//     { label: '显示窗口', click: () => showMainWindow() },
//     { type: 'separator' },
//     { label: '退出', click: () => app.quit() }
//   ])
// }
//
// function updateTrayMenu() {
//   tray.setContextMenu(buildTrayMenu())
// }

// ===== Update BrowserView Bounds =====
function updateBrowserViewBounds() {
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
function createEdgeWindow(parentWin) {
  if (edgeWindow) return

  const contentBounds = parentWin.getContentBounds()
  const parentBounds = parentWin.getBounds()
  const pillY = contentBounds.y + Math.round((contentBounds.height - EDGE_PILL_HEIGHT) / 2)

  edgeWindow = new BrowserWindow({
    width: EDGE_PILL_WIDTH,
    height: EDGE_PILL_HEIGHT,
    x: parentBounds.x,
    y: pillY,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    parent: parentWin,
    webPreferences: {
      preload: path.join(__dirname, 'edge-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  edgeWindow.loadFile(path.join(__dirname, '../src/edge.html'), {
    query: { theme: currentTheme }
  })

  let edgeMoveTimer = null
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
  edgeWindow._cleanup = () => {
    parentWin.removeListener('move', updateEdge)
    parentWin.removeListener('resize', updateEdge)
  }
}

function updateEdgeWindowPosition() {
  if (!edgeWindow) return

  const parentWin = getActiveWin()
  if (!parentWin) return

  const contentBounds = parentWin.getContentBounds()
  const pillY = contentBounds.y + Math.round((contentBounds.height - EDGE_PILL_HEIGHT) / 2)

  edgeWindow.setPosition(contentBounds.x, pillY)
}

function destroyEdgeWindow() {
  if (edgeWindow) {
    if (edgeWindow._cleanup) edgeWindow._cleanup()
    edgeWindow.close()
    edgeWindow = null
  }
}

// ===== Switch Provider (BrowserView 缓存，切换不销毁) =====
function switchProvider(key) {
  const provider = getMergedProviders().find(p => p.key === key)
  if (!provider) return

  const win = getActiveWin()
  if (!win) return

  // 隐藏当前 view
  const prevView = views.get(currentProviderKey)
  if (prevView && prevView.webContents && !prevView.webContents.isDestroyed()) {
    try { win.removeBrowserView(prevView) } catch (e) {}
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
    view.webContents.on('before-input-event', (event, input) => {
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
      view.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(() => {})
      // 对需要重载的服务商延迟注入主题，等页面 JS 初始化完成读取 localStorage
      const themeDelay = NEEDS_THEME_RELOAD.has(key) ? 300 : 0
      setTimeout(() => {
        if (view.webContents && !view.webContents.isDestroyed()) {
          view.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(() => {})
        }
      }, themeDelay)
      // 页面加载完成后发送侧边栏颜色
      if (provider.color) {
        const sidebarColor = provider.color[currentTheme] || provider.color.dark
        getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
      }
    })

    view.webContents.on('did-fail-load', (e, errorCode, errorDesc) => {
      // 清除死 view，下次切换时重建
      views.delete(key)
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'error', error: errorDesc })
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
  if (view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.insertCSS('*,*::before,*::after{-webkit-app-region:no-drag!important}').catch(() => {})
    win.addBrowserView(view)
    updateBrowserViewBounds()

    if (!view.webContents.isLoading()) {
      getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
    }

    // 发送侧边栏颜色
    if (provider.color) {
      const sidebarColor = provider.color[currentTheme] || provider.color.dark
      getActiveWin()?.webContents?.send('sidebar-color', sidebarColor)
    }
  }
}

// ===== Setup IPC =====
function setupIPC() {
  ipcMain.on('switch-provider', (event, key) => {
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
  ipcMain.handle('save-provider-settings', (event, settings) => {
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

  ipcMain.handle('save-provider-order', (event, order) => {
    providerOrder = order
    saveSettings()
    if (mainWindow) mainWindow.webContents.send('providers-updated', getMergedProviders())
    if (popupWindow) popupWindow.webContents.send('providers-updated', getMergedProviders())
  })

  ipcMain.on('sidebar-state', (event, collapsed) => {
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

  ipcMain.on('toggle-settings', (event, show) => {
    const view = views.get(currentProviderKey)
    const win = getActiveWin()
    if (!view || !win || view.webContents?.isDestroyed()) return
    if (show) {
      try { win.removeBrowserView(view) } catch (e) {}
    } else {
      win.addBrowserView(view)
      updateBrowserViewBounds()
    }
  })

  ipcMain.handle('get-shortcut', () => currentShortcut)
  ipcMain.handle('set-shortcut', (event, acc) => {
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
  ipcMain.handle('set-switch-shortcut', (event, acc) => {
    if (acc && acc === currentShortcut) {
      return { ok: false, error: '与全局快捷键冲突，请选择其他组合' }
    }
    switchShortcut = acc || 'Shift+Tab'
    saveSettings()
    return { ok: true }
  })

  // 获取网站 favicon
  ipcMain.handle('fetch-favicon', async (event, url) => {
    return await fetchFavicon(url)
  })

  // 从 URL 获取图标（供设置页手动输入图标网址使用）
  ipcMain.handle('fetch-icon-url', async (event, iconUrl) => {
    return await tryFetchIcon(iconUrl)
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
      return { ok: false, error: '注入失败：' + e.message }
    }
  })

  ipcMain.on('move-window', (event, dx, dy) => {
    const win = getActiveWin()
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  ipcMain.on('theme-changed', (event, theme) => {
    if (theme === currentTheme && initialProviderLoaded) return
    currentTheme = theme
    nativeTheme.themeSource = theme
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
      }).catch(() => {})
      // 主题切换后更新侧边栏颜色
      const provider = getMergedProviders().find(p => p.key === currentProviderKey)
      if (provider?.color) {
        const sidebarColor = provider.color[theme] || provider.color.dark
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
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) return { ok: false }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('install-update', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })
}

// ===== Setup Menu =====
function setupMenu() {
  const template = [
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
    }
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

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'window') return
  contents.on('will-navigate', (navEvent, url) => {
    if (url && url.startsWith('file://')) {
      navEvent.preventDefault()
    }
  })
})
