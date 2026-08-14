// ===== 窗口管理模块 =====
// 负责主窗口、弹窗、边缘条窗口的创建、销毁和位置管理

import { BrowserWindow, screen, app } from 'electron'
import path from 'path'
import log from 'electron-log'
import { POPUP_WIDTH, POPUP_HEIGHT, EDGE_PILL_WIDTH, EDGE_PILL_HEIGHT, RESIZE_UPDATE_DELAY_MS, BOUNDS_SAVE_DELAY_MS, MODE } from './config'

// ===== 状态 =====
let mainWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null
let edgeWindow: BrowserWindow | null = null
let savedBounds: { x: number; y: number; width: number; height: number } | null = null
let currentTheme = 'dark'
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null

// ===== 外部回调 =====
let updateBrowserViewBoundsFn: (() => void) | null = null
let saveWindowBoundsFn: (() => void) | null = null
let switchProviderFn: ((key: string) => void) | null = null
let getCurrentProviderKeyFn: (() => string) | null = null
let hasViewFn: ((key: string) => boolean) | null = null
let onWindowCloseFn: (() => void) | null = null

// ===== 初始化回调注入 =====
export function initWindowManager(deps: {
  updateBrowserViewBounds: () => void
  saveWindowBounds: () => void
  switchProvider: (key: string) => void
  getCurrentProviderKey: () => string
  hasView: (key: string) => boolean
  onWindowClose: () => void
}): void {
  updateBrowserViewBoundsFn = deps.updateBrowserViewBounds
  saveWindowBoundsFn = deps.saveWindowBounds
  switchProviderFn = deps.switchProvider
  getCurrentProviderKeyFn = deps.getCurrentProviderKey
  hasViewFn = deps.hasView
  onWindowCloseFn = deps.onWindowClose
}

// ===== 设置 =====
export function setSavedBounds(bounds: { x: number; y: number; width: number; height: number } | null): void {
  savedBounds = bounds
}
export function setCurrentTheme(theme: string): void {
  currentTheme = theme
}
export function getSavedBoundsValue(): { x: number; y: number; width: number; height: number } | null {
  return savedBounds
}

// ===== 窗口引用 =====
export function getMainWindowRef(): BrowserWindow | null { return mainWindow }
export function getPopupWindowRef(): BrowserWindow | null { return popupWindow }

// ===== 获取活跃窗口 =====
export function getActiveWin(mode: string): BrowserWindow | null {
  return mode === MODE.MENUBAR ? popupWindow : mainWindow
}

// ===== 校验窗口位置 =====
export function isValidBounds(bounds: { x: number; y: number; width: number; height: number } | null): boolean {
  if (!bounds) return false
  if (bounds.width < 600 || bounds.height < 400) return false
  const displays = screen.getAllDisplays()
  return displays.some(d => {
    const { x, y, width, height } = d.workArea
    const leftOk = bounds.x >= x - 100
    const rightOk = bounds.x + bounds.width <= x + width + 100
    const topOk = bounds.y >= y - 100
    const bottomOk = bounds.y + bounds.height <= y + height + 100
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    const centerInDisplay = centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height
    return leftOk && rightOk && topOk && bottomOk && centerInDisplay
  })
}

// ===== 创建主窗口 =====
export function createMainWindow(mode: string): void {
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
      contextIsolation: true,
      sandbox: true
    }
  })

  // electron-vite: 开发模式使用 dev server URL，生产模式用文件
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

  // 窗口大小变化时更新 BrowserView（debounce）
  mainWindow.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      if (updateBrowserViewBoundsFn) updateBrowserViewBoundsFn()
    }, RESIZE_UPDATE_DELAY_MS)
  })

  // 窗口移动/调整大小时延迟保存位置
  const scheduleBoundsSave = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      if (saveWindowBoundsFn) saveWindowBoundsFn()
    }, BOUNDS_SAVE_DELAY_MS)
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
    if (onWindowCloseFn) onWindowCloseFn()
    mainWindow = null
  })
}

// ===== 显示主窗口 =====
export function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow(MODE.WINDOW)
  }
  mainWindow!.show()
  mainWindow!.focus()

  if (switchProviderFn && getCurrentProviderKeyFn && hasViewFn) {
    if (!hasViewFn(getCurrentProviderKeyFn())) {
      switchProviderFn(getCurrentProviderKeyFn())
    }
  }
}

// ===== 切换窗口可见性 =====
export function toggleWindowVisibility(): void {
  const win = mainWindow
  if (!win) { showMainWindow(); return }
  if (win.isVisible() && (popupWindow && popupWindow.isVisible())) {
    popupWindow.hide()
  } else if (win.isVisible()) {
    win.hide()
  } else {
    showMainWindow()
  }
}

// ===== 创建弹窗 =====
export function createPopupWindow(): BrowserWindow {
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
      contextIsolation: true,
      sandbox: true
    }
  })

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

// ===== 切换弹窗 =====
export function togglePopup(
  switchProviderFn_: (key: string) => void,
  getCurrentProviderKey_: () => string,
  hasView_: (key: string) => boolean
): void {
  if (!popupWindow) {
    createPopupWindow()
  }

  if (popupWindow!.isVisible()) {
    popupWindow!.hide()
  } else {
    popupWindow!.show()
    popupWindow!.focus()

    if (!hasView_(getCurrentProviderKey_())) {
      switchProviderFn_(getCurrentProviderKey_())
    }
  }
}

// ===== 创建边缘条窗口 =====
export function createEdgeWindow(parentWin: BrowserWindow): void {
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
      contextIsolation: true,
      sandbox: true
    }
  })

  const edgeQuery = `theme=${currentTheme}`

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
    }, RESIZE_UPDATE_DELAY_MS)
  }
  parentWin.on('move', updateEdge)
  parentWin.on('resize', updateEdge)
  ;(edgeWindow as unknown as Record<string, unknown>)._cleanup = () => {
    parentWin.removeListener('move', updateEdge)
    parentWin.removeListener('resize', updateEdge)
  }
}

// ===== 更新边缘条位置 =====
export function updateEdgeWindowPosition(): void {
  if (!edgeWindow) return

  const parentWin = mainWindow || popupWindow
  if (!parentWin) return

  const contentBounds = parentWin.getContentBounds()
  const pillY = contentBounds.y + Math.round((contentBounds.height - EDGE_PILL_HEIGHT) / 2)

  edgeWindow.setPosition(contentBounds.x, pillY)
}

// ===== 销毁边缘条窗口 =====
export function destroyEdgeWindow(): void {
  if (edgeWindow) {
    const win = edgeWindow as unknown as Record<string, unknown>
    if (typeof (win._cleanup) === 'function') {
      try {
        (win._cleanup as () => void)()
      } catch (e) {
        log.error('Failed to cleanup edgeWindow listeners:', e)
      }
    }
    try {
      edgeWindow.close()
    } catch (e) {
      log.error('Failed to close edgeWindow:', e)
    }
    edgeWindow = null
  }
}

// ===== 设置模式 =====
export function setMode(newMode: string): void {
  if (newMode === MODE.WINDOW) {
    showMainWindow()
    if (popupWindow) popupWindow.hide()
  } else {
    if (mainWindow) mainWindow.hide()
  }

  if (mainWindow) mainWindow.webContents.send('mode-changed', newMode)
  if (popupWindow) popupWindow.webContents.send('mode-changed', newMode)
}

// ===== 发送主题变更到边缘条 =====
export function sendEdgeThemeChange(theme: string): void {
  if (edgeWindow) {
    edgeWindow.webContents.send('edge-theme-changed', theme)
  }
}

// ===== 窗口按钮可见性 =====
export function setWindowButtonVisibility(visible: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setWindowButtonVisibility(visible)
  }
}
