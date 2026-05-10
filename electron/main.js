const { app, BrowserWindow, BrowserView, Tray, ipcMain, Menu, nativeImage, screen, nativeTheme, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

// ===== Providers =====
// base64 data URL，路径区分开发/打包
const iconBaseDir = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '..', 'assets')
function loadIcon(name) {
  return `data:image/png;base64,${fs.readFileSync(path.join(iconBaseDir, name)).toString('base64')}`
}
const PROVIDERS = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: loadIcon('deepseek.png') },
  { key: 'doubao',   name: '豆包',     url: 'https://www.doubao.com/chat/',  icon: loadIcon('doubao.png') },
  { key: 'kimi',     name: 'Kimi',     url: 'https://kimi.moonshot.cn/',     icon: loadIcon('kimi.png') },
  { key: 'metaso',   name: 'Metaso',   url: 'https://metaso.cn/',            icon: loadIcon('metaso.png') }
]

// 不遵循 prefers-color-scheme 的服务需要注入 localStorage 后重载
const NEEDS_THEME_RELOAD = new Set(['doubao', 'metaso'])

// ===== Constants =====
const MODE = { WINDOW: 'window', MENUBAR: 'menubar' }
const THEME = { DARK: 'dark', LIGHT: 'light' }
const SIDEBAR_WIDTH = 74
const EDGE_WIDTH = 0
const EDGE_PILL_WIDTH = 16
const EDGE_PILL_HEIGHT = 48
const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

// ===== State =====
let mainWindow = null
let popupWindow = null
let tray = null
const views = new Map() // providerKey → BrowserView 缓存，切换不销毁
let currentProviderKey = 'deepseek'
let mode = MODE.WINDOW
let SIDEBAR_COLLAPSED = false
let edgeWindow = null
let currentTheme = THEME.DARK
let initialProviderLoaded = false
let currentShortcut = 'Cmd+Shift+Space'
let switchShortcut = 'Shift+Tab'

// ===== Helpers =====
function getActiveWin() {
  return mode === MODE.MENUBAR ? popupWindow : mainWindow
}

// 预计算主题注入脚本，避免每次构建字符串
const THEME_BG = { [THEME.DARK]: '#0d0f14', [THEME.LIGHT]: '#ffffff' }

const THEME_SCRIPTS = {
  [THEME.DARK]: `(function(){var t='dark';var k=['theme','darkMode','theme-mode','app_theme','THEME_MODE','arco-theme','themeType','byte_theme'];k.forEach(function(x){try{localStorage.setItem(x,t)}catch(e){}});document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.add('dark');document.documentElement.classList.remove('light');try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t}))}catch(e){}})()`,
  [THEME.LIGHT]: `(function(){var t='light';var k=['theme','darkMode','theme-mode','app_theme','THEME_MODE','arco-theme','themeType','byte_theme'];k.forEach(function(x){try{localStorage.setItem(x,t)}catch(e){}});document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.add('light');document.documentElement.classList.remove('dark');try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t}))}catch(e){}})()`
}

// ===== App Ready =====
function registerGlobalShortcut(acc) {
  globalShortcut.unregisterAll()
  if (!acc) return
  const registered = globalShortcut.register(acc, () => {
    const win = mainWindow
    if (!win) { showMainWindow(); return }
    if (win.isVisible() && (mode === MODE.WINDOW || (popupWindow && popupWindow.isVisible()))) {
      if (mode === MODE.MENUBAR && popupWindow) popupWindow.hide()
      else win.hide()
    } else {
      showMainWindow()
    }
  })
  if (!registered) console.error('Failed to register global shortcut:', acc)
}

app.whenReady().then(() => {
  createTray()
  createMainWindow()
  setupIPC()
  setupMenu()
  registerGlobalShortcut(currentShortcut)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// ===== Create Main Window =====
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    show: false, // 先不显示，等加载完成
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 8, y: 6 },
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

  // 窗口准备好后显示；首次服务加载等待渲染进程发送初始主题后再触发
  mainWindow.once('ready-to-show', () => {
    if (mode === MODE.WINDOW) {
      mainWindow.show()
    }
  })

  // 窗口尺寸变化时调整 BrowserView（debounce 避免高频触发）
  let resizeTimer = null
  mainWindow.on('resize', () => {
    if (resizeTimer) return
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      updateBrowserViewBounds()
    }, 16)
  })

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

// ===== Create Tray =====
function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip('MineAI Hub')

  tray.setContextMenu(buildTrayMenu())

  tray.on('click', () => {
    if (mode === MODE.MENUBAR) {
      togglePopup()
    } else {
      showMainWindow()
    }
  })
}

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

    // 确保当前服务已加载
    if (!views.has(currentProviderKey)) {
      switchProvider(currentProviderKey)
    }
  }
}

function positionPopup() {
  if (!tray || !popupWindow) return

  const trayBounds = tray.getBounds()
  const popupWidth = POPUP_WIDTH

  // 计算位置：居中对齐托盘图标
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - popupWidth / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + 4)

  // 确保不超出屏幕边界
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

  // 确保当前服务已加载
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

  // 通知渲染进程
  if (mainWindow) {
    mainWindow.webContents.send('mode-changed', mode)
  }
  if (popupWindow) {
    popupWindow.webContents.send('mode-changed', mode)
  }

  // 更新托盘菜单
  updateTrayMenu()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '模式',
      submenu: [
        { label: '独立窗口', type: 'radio', checked: true },
        { label: '菜单栏', enabled: false }
      ]
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
}

function updateTrayMenu() {
  tray.setContextMenu(buildTrayMenu())
}

// ===== Update BrowserView Bounds =====
function updateBrowserViewBounds() {
  const view = views.get(currentProviderKey)
  if (!view || view.isDestroyed()) return

  const win = getActiveWin()
  if (!win) return

  const contentBounds = win.getContentBounds()

  const effectiveSidebarWidth = SIDEBAR_COLLAPSED ? EDGE_WIDTH : SIDEBAR_WIDTH
  const viewWidth = contentBounds.width - effectiveSidebarWidth
  const viewHeight = contentBounds.height
  const viewY = contentBounds.y - win.getBounds().y

  view.setBounds({
    x: effectiveSidebarWidth,
    y: Math.max(0, viewY),
    width: viewWidth,
    height: viewHeight
  })

  if (SIDEBAR_COLLAPSED) {
    createEdgeWindow(win)
  } else {
    destroyEdgeWindow()
  }
}

// 创建边缘条窗口（悬浮腰圆条，类似 iOS 底部横条）
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

  // 跟随父窗口移动和调整大小（debounce）
  let edgeMoveTimer = null
  const debouncedUpdateEdge = () => {
    if (edgeMoveTimer) return
    edgeMoveTimer = setTimeout(() => {
      edgeMoveTimer = null
      if (!edgeWindow) return
      updateEdgeWindowPosition()
    }, 16)
  }
  parentWin.on('move', debouncedUpdateEdge)
  parentWin.on('resize', debouncedUpdateEdge)
  edgeWindow._cleanup = () => {
    parentWin.removeListener('move', debouncedUpdateEdge)
    parentWin.removeListener('resize', debouncedUpdateEdge)
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
  const provider = PROVIDERS.find(p => p.key === key)
  if (!provider) return

  const win = getActiveWin()
  if (!win) return

  // 隐藏当前 view
  const prevView = views.get(currentProviderKey)
  if (prevView && !prevView.isDestroyed()) {
    try { win.removeBrowserView(prevView) } catch (e) {}
  }

  // 获取或创建目标 view
  let view = views.get(key)
  if (!view || view.isDestroyed()) {
    view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
    views.set(key, view)

    view.webContents.loadURL(provider.url)
    win.webContents.send('loading', { provider: key, status: 'loading' })

    // 切换服务商快捷键（可自定义，默认 Shift+Tab）
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !switchShortcut) return
      const parts = switchShortcut.split('+')
      const expectedMods = new Set(parts.filter(p => ['Meta','Control','Alt','Shift'].includes(p)))
      const expectedKey = parts.find(p => !['Meta','Control','Alt','Shift'].includes(p))
      if (!expectedKey) return
      if (input.meta !== expectedMods.has('Meta')) return
      if (input.control !== expectedMods.has('Control')) return
      if (input.alt !== expectedMods.has('Alt')) return
      if (input.shift !== expectedMods.has('Shift')) return
      const keyCode = input.code.startsWith('Key') ? input.code.slice(3) : input.code
      if (keyCode !== expectedKey) return
      const idx = PROVIDERS.findIndex(p => p.key === currentProviderKey)
      const next = PROVIDERS[(idx + 1) % PROVIDERS.length]
      if (next.key !== currentProviderKey) switchProvider(next.key)
    })

    view.webContents.on('did-finish-load', () => {
      if (currentProviderKey === key) {
        win.webContents.send('loading', { provider: key, status: 'loaded' })
      }
      view.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(() => {})
    })

    view.webContents.on('did-fail-load', (e, errorCode, errorDesc) => {
      if (currentProviderKey === key) {
        win.webContents.send('loading', { provider: key, status: 'error', error: errorDesc })
      }
    })
  }

  currentProviderKey = key
  if (!view.isDestroyed()) {
    win.addBrowserView(view)
    updateBrowserViewBounds()

    // 如果已加载，直接通知就绪
    if (!view.webContents.isLoading()) {
      win.webContents.send('loading', { provider: key, status: 'loaded' })
    }
  }
}

// ===== Setup IPC =====
function setupIPC() {
  // 切换服务
  ipcMain.on('switch-provider', (event, key) => {
    switchProvider(key)
  })

  // 重载当前页面
  ipcMain.on('reload', () => {
    const view = views.get(currentProviderKey)
    if (view && !view.isDestroyed()) view.webContents.reload()
  })

  // 切换模式
  ipcMain.handle('toggle-mode', () => {
    setMode(mode === MODE.WINDOW ? MODE.MENUBAR : MODE.WINDOW)
    return mode
  })

  // 获取当前模式
  ipcMain.handle('get-mode', () => mode)

  // 获取当前服务
  ipcMain.handle('get-current-provider', () => currentProviderKey)

  // 获取所有服务
  ipcMain.handle('get-providers', () => PROVIDERS)

  // 侧边栏状态变化（专注模式）
  ipcMain.on('sidebar-state', (event, collapsed) => {
    SIDEBAR_COLLAPSED = collapsed
    updateBrowserViewBounds()
  })

  // 退出专注模式（从边缘条窗口）
  ipcMain.on('exit-focus', () => {
    SIDEBAR_COLLAPSED = false
    destroyEdgeWindow()
    updateBrowserViewBounds()

    // 通知渲染进程
    if (mainWindow) mainWindow.webContents.send('exit-focus-mode')
    if (popupWindow) popupWindow.webContents.send('exit-focus-mode')
  })

  // 设置页面显隐
  ipcMain.on('toggle-settings', (event, show) => {
    const view = views.get(currentProviderKey)
    const win = getActiveWin()
    if (!view || !win || view.isDestroyed()) return
    if (show) {
      try { win.removeBrowserView(view) } catch (e) {}
    } else {
      win.addBrowserView(view)
      updateBrowserViewBounds()
    }
  })

  // 快捷键设置
  ipcMain.handle('get-shortcut', () => currentShortcut)
  ipcMain.handle('set-shortcut', (event, acc) => {
    currentShortcut = acc
    globalShortcut.unregisterAll()
    if (acc) {
      globalShortcut.register(acc, () => {
        const win = mainWindow
        if (!win) { showMainWindow(); return }
        if (win.isVisible() && (mode === MODE.WINDOW || (popupWindow && popupWindow.isVisible()))) {
          if (mode === MODE.MENUBAR && popupWindow) popupWindow.hide()
          else win.hide()
        } else {
          showMainWindow()
        }
      })
    }
  })

  // 切换服务商快捷键
  ipcMain.handle('get-switch-shortcut', () => switchShortcut)
  ipcMain.handle('set-switch-shortcut', (event, acc) => {
    switchShortcut = acc || 'Shift+Tab'
  })

  // 边缘条拖拽移动窗口（专注模式下）
  ipcMain.on('move-window', (event, dx, dy) => {
    const win = getActiveWin()
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  // 主题变化同步到边缘条窗口及所有 BrowserView
  ipcMain.on('theme-changed', (event, theme) => {
    if (theme === currentTheme && initialProviderLoaded) return // 避免重复更新
    currentTheme = theme
    nativeTheme.themeSource = theme
    if (edgeWindow) {
      edgeWindow.webContents.send('edge-theme-changed', theme)
    }
    // 首次：收到渲染进程主题后加载默认服务
    if (!initialProviderLoaded) {
      initialProviderLoaded = true
      switchProvider(currentProviderKey)
      return
    }
    // 后续主题切换：注入 localStorage；对不遵循 prefers-color-scheme 的服务重载页面
    const view = views.get(currentProviderKey)
    if (view && view.webContents && !view.isDestroyed()) {
      view.webContents.executeJavaScript(THEME_SCRIPTS[theme]).then(() => {
        if (NEEDS_THEME_RELOAD.has(currentProviderKey)) {
          view.webContents.reload()
        }
      }).catch(() => {})
    }
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

// ===== Prevent navigation in main window =====
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'window') return
  contents.on('will-navigate', (navEvent, url) => {
    if (url && url.startsWith('file://')) {
      navEvent.preventDefault()
    }
  })
})
