const { app, BrowserWindow, BrowserView, Tray, ipcMain, Menu, nativeImage, screen, nativeTheme, globalShortcut } = require('electron')
const path = require('path')
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
  matchesKeyEvent
} = require('./config')

// ===== State =====
let mainWindow = null
let popupWindow = null
let tray = null
const views = new Map() // providerKey -> BrowserView 缓存，切换不销毁
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
    show: false,
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

  mainWindow.once('ready-to-show', () => {
    if (mode === MODE.WINDOW) {
      mainWindow.show()
    }
  })

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
  const provider = PROVIDERS.find(p => p.key === key)
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

    view.webContents.loadURL(provider.url)
    getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loading' })

    // 切换服务商快捷键
    view.webContents.on('before-input-event', (event, input) => {
      if (!matchesKeyEvent(input, switchShortcut)) return
      const idx = PROVIDERS.findIndex(p => p.key === currentProviderKey)
      const next = PROVIDERS[(idx + 1) % PROVIDERS.length]
      if (next.key !== currentProviderKey) switchProvider(next.key)
    })

    view.webContents.on('did-finish-load', () => {
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
      }
      view.webContents.executeJavaScript(THEME_SCRIPTS[currentTheme]).catch(() => {})
    })

    view.webContents.on('did-fail-load', (e, errorCode, errorDesc) => {
      // 清除死 view，下次切换时重建
      views.delete(key)
      if (currentProviderKey === key) {
        getActiveWin()?.webContents?.send('loading', { provider: key, status: 'error', error: errorDesc })
      }
    })
  }

  currentProviderKey = key
  if (view.webContents && !view.webContents.isDestroyed()) {
    win.addBrowserView(view)
    updateBrowserViewBounds()

    if (!view.webContents.isLoading()) {
      getActiveWin()?.webContents?.send('loading', { provider: key, status: 'loaded' })
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
  ipcMain.handle('get-current-provider', () => currentProviderKey)
  ipcMain.handle('get-providers', () => PROVIDERS)

  ipcMain.on('sidebar-state', (event, collapsed) => {
    SIDEBAR_COLLAPSED = collapsed
    updateBrowserViewBounds()
  })

  ipcMain.on('exit-focus', () => {
    SIDEBAR_COLLAPSED = false
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
    currentShortcut = acc
    globalShortcut.unregisterAll()
    if (acc) {
      globalShortcut.register(acc, toggleWindowVisibility)
    }
  })

  ipcMain.handle('get-switch-shortcut', () => switchShortcut)
  ipcMain.handle('set-switch-shortcut', (event, acc) => {
    switchShortcut = acc || 'Shift+Tab'
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

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'window') return
  contents.on('will-navigate', (navEvent, url) => {
    if (url && url.startsWith('file://')) {
      navEvent.preventDefault()
    }
  })
})
