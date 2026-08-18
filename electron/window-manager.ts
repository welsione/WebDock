// ===== 窗口管理模块 =====
// 负责主窗口、边缘条窗口的创建、销毁和位置管理
// （MENUBAR 弹窗模式已下线：popupWindow 从不显示且无 UI 承载，相关代码已删除）

import { BrowserWindow, screen } from 'electron'
import path from 'path'
import log from 'electron-log'
import { EDGE_PILL_WIDTH, EDGE_PILL_HEIGHT, EDGE_FADE_MS, RESIZE_UPDATE_DELAY_MS, BOUNDS_SAVE_DELAY_MS } from './config'

// ===== 状态 =====
let mainWindow: BrowserWindow | null = null
let edgeWindow: BrowserWindow | null = null
let savedBounds: { x: number; y: number; width: number; height: number } | null = null
let currentTheme = 'dark'
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 边缘条淡出中（防止重复销毁把动画掐断 / 淡出期间重复调用直接跳过） */
let edgeFading = false
let edgeFadeTimer: ReturnType<typeof setTimeout> | null = null
/** 应用是否正在退出（before-quit 置位；为 true 时窗口 close 放行，否则隐藏） */
let isQuitting = false

export function setQuittingFlag(v: boolean): void {
  isQuitting = v
}

// ===== 外部回调 =====
let updateBrowserViewBoundsFn: (() => void) | null = null
let saveWindowBoundsFn: (() => void) | null = null
let switchWebAppFn: ((key: string) => void) | null = null
let getCurrentWebAppKeyFn: (() => string) | null = null
let hasViewFn: ((key: string) => boolean) | null = null
let attachViewFn: ((key: string) => void) | null = null
let onWindowCloseFn: (() => void) | null = null

// ===== 初始化回调注入 =====
export function initWindowManager(deps: {
  updateBrowserViewBounds: () => void
  saveWindowBounds: () => void
  switchWebApp: (key: string) => void
  getCurrentWebAppKey: () => string
  hasView: (key: string) => boolean
  attachView: (key: string) => void
  onWindowClose: () => void
}): void {
  updateBrowserViewBoundsFn = deps.updateBrowserViewBounds
  saveWindowBoundsFn = deps.saveWindowBounds
  switchWebAppFn = deps.switchWebApp
  getCurrentWebAppKeyFn = deps.getCurrentWebAppKey
  hasViewFn = deps.hasView
  attachViewFn = deps.attachView
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

// ===== 获取活跃窗口 =====
export function getActiveWin(): BrowserWindow | null {
  return mainWindow
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
export function createMainWindow(): void {
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

  // 开发模式不再自动打开 DevTools（Autofill 等 Chromium 噪音日志来源）；
  // 需要时用菜单「开发 → 打开主窗口 DevTools」或 Cmd+Option+I

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
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

  // 点红点 = 隐藏窗口（macOS 惯例，页面与登录态原样保留，重新打开零加载）；
  // 真正退出（Cmd+Q）前 main.ts 会置 quitting 标志，此时放行关闭
  mainWindow.on('close', (e) => {
    destroyEdgeWindow()
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
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
    createMainWindow()
  }
  mainWindow!.show()
  mainWindow!.focus()

  if (switchWebAppFn && getCurrentWebAppKeyFn && hasViewFn) {
    if (hasViewFn(getCurrentWebAppKeyFn())) {
      // view 已存在（隐藏/重建窗口场景）：直接挂载，不重新加载页面
      if (attachViewFn) attachViewFn(getCurrentWebAppKeyFn())
    } else {
      switchWebAppFn(getCurrentWebAppKeyFn())
    }
  }
}

// ===== 切换窗口可见性 =====
export function toggleWindowVisibility(): void {
  const win = mainWindow
  if (!win) { showMainWindow(); return }
  if (win.isVisible()) {
    win.hide()
  } else {
    showMainWindow()
  }
}

// ===== 创建边缘条窗口 =====
export function createEdgeWindow(parentWin: BrowserWindow): void {
  // 淡出进行中重新进入沉浸模式：取消淡出，复用现有窗口并恢复显示
  if (edgeWindow) {
    if (edgeFading) {
      if (edgeFadeTimer) {
        clearTimeout(edgeFadeTimer)
        edgeFadeTimer = null
      }
      edgeFading = false
      try {
        edgeWindow.webContents.send('edge-show')
      } catch { /* 页面可能未加载完成 */ }
      updateEdgeWindowPosition()
    }
    return
  }

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
  const win = edgeWindow
  const parentWin = mainWindow
  if (!win || win.isDestroyed() || !parentWin || parentWin.isDestroyed()) return

  const bounds = parentWin.getContentBounds()
  // 防止瞬时状态（拖动中窗口重排/重建）返回非法值：NaN 传入 setPosition 会抛
  // "Error processing argument at index 0, conversion failure from NaN" 崩溃
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    log.warn('updateEdgeWindowPosition: 无效 contentBounds, 跳过本次跟随', bounds)
    return
  }
  const pillY = bounds.y + Math.round((bounds.height - EDGE_PILL_HEIGHT) / 2)
  if (!Number.isFinite(pillY)) return
  try {
    win.setPosition(bounds.x, pillY)
  } catch (e) {
    log.error('updateEdgeWindowPosition failed:', e, { bounds, pillY })
  }
}

// ===== 销毁边缘条窗口 =====
function destroyEdgeWindowNow(): void {
  if (edgeFadeTimer) {
    clearTimeout(edgeFadeTimer)
    edgeFadeTimer = null
  }
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
  edgeFading = false
}

/** 销毁边缘条：正常运行时先让渲染进程淡出（CSS 过渡 150ms）再销毁；退出时直接销毁 */
export function destroyEdgeWindow(): void {
  if (!edgeWindow) return
  if (!isQuitting && !edgeFading) {
    edgeFading = true
    try {
      edgeWindow.webContents.send('edge-fade-out')
    } catch { /* 页面可能未加载完成 */ }
    edgeFadeTimer = setTimeout(() => {
      edgeFadeTimer = null
      edgeFading = false
      destroyEdgeWindowNow()
    }, EDGE_FADE_MS)
    return
  }
  // 淡出进行中：忽略重复调用，等淡出结束统一销毁（避免把动画掐断）
  if (edgeFading) return
  destroyEdgeWindowNow()
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

// ===== 设置主窗口标题 =====
export function setMainWindowTitle(title: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title)
  }
}
