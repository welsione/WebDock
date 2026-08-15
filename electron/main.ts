// ===== WebDock — 主进程入口 =====
// 仅负责模块组装和初始化，业务逻辑拆分至各子模块

import { app, session } from 'electron'
import path from 'path'
import {
  loadSettings, saveSettings, SETTINGS_VERSION, DEFAULT_APP_SETTINGS
} from './settings-store'
import { migrateSettings } from './settings-migration'
import { buildMigrationPlan, migrateUserData } from './userdata-migration'
import { NotificationStore } from './notification-store'
import {
  switchWebApp, getCurrentWebAppKey, initBrowserViewManager,
  setWebApps, setAppSettings, setSwitchShortcut, updateBrowserViewBounds,
  getViewsMap, getMergedWebApps, getWebAppsList, getAppSettings,
  getWebAppKeyByWebContents, attachView, setViewUrls, getViewUrls
} from './browser-view-manager'
import {
  createMainWindow, showMainWindow, toggleWindowVisibility,
  getMainWindowRef, createEdgeWindow, destroyEdgeWindow,
  getActiveWin as getActiveWinFromMgr,
  setSavedBounds, getSavedBoundsValue, initWindowManager, setMainWindowTitle,
  setQuittingFlag
} from './window-manager'
import { getCurrentShortcut, setCurrentShortcut, registerGlobalShortcut, setToggleHandler, unregisterAllShortcuts } from './shortcut-manager'
import { setupIPC } from './ipc-handlers'
import { setupAutoUpdater, setUpdateWindows } from './auto-updater'
import { buildMenu } from './app-menu'
import { shutdownManagedServices } from './service-launcher'
import { PRESET_WEB_APPS, PAGE_TITLE_SYNC_DEBOUNCE_MS } from './config'
import type { StoredWebApp } from './settings-store'

// ===== 通知收件箱（全局单例，数据层：清洗/去重/限频/持久化） =====
const notifyStore = new NotificationStore(path.join(app.getPath('userData'), 'notifications.json'))

// ===== 窗口标题同步（防抖） =====
let titleSyncTimer: ReturnType<typeof setTimeout> | null = null

function handlePageTitle(key: string, title: string): void {
  if (titleSyncTimer) clearTimeout(titleSyncTimer)
  titleSyncTimer = setTimeout(() => {
    titleSyncTimer = null
    const webApp = getMergedWebApps().find(a => a.key === key)
    const name = webApp?.name ?? 'WebDock'
    const full = title ? `${name} — ${title}` : name
    setMainWindowTitle(full)
  }, PAGE_TITLE_SYNC_DEBOUNCE_MS)
}

// ===== 会话安全：权限与证书 =====
function setupSessionPolicies(): void {
  // 每应用权限：摄像头/麦克风/定位按配置，其余拒绝；通知由桥接管放行
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
      return
    }
    const key = getWebAppKeyByWebContents(wc)
    const webApp = key ? getMergedWebApps().find(a => a.key === key) : undefined
    const perms = webApp?.permissions
    let allow = false
    if (permission === 'media') {
      allow = perms?.camera === 'allow' || perms?.microphone === 'allow'
    } else if (permission === 'geolocation') {
      allow = perms?.geolocation === 'allow'
    }
    callback(allow)
  })

  // 自签名证书：仅信任用户显式配置的应用（本地 https 服务场景）
  app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
    try {
      const origin = new URL(url).origin
      const webApp = getMergedWebApps().find(a => {
        try {
          return new URL(a.url).origin === origin
        } catch {
          return false
        }
      })
      if (webApp?.trustCertificate) {
        event.preventDefault()
        callback(true)
        return
      }
    } catch {
      // fallthrough：拒绝
    }
    callback(false)
  })

  // 生产环境 CSP（纵深防御；渲染进程 index.html 已有 meta CSP）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'"
          ]
        }
      })
      return
    }
    callback({})
  })
}

// ===== 窗口边界保存 =====
function saveWindowBounds(): void {
  const main = getMainWindowRef()
  if (!main || main.isDestroyed()) return
  const b = main.getBounds()
  setSavedBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  // 只保存窗口边界，其他设置由各自模块负责，避免全量覆盖丢失用户配置
  void saveSettings({ windowBounds: getSavedBoundsValue() })
}

initWindowManager({
  updateBrowserViewBounds, saveWindowBounds, switchWebApp, getCurrentWebAppKey,
  hasView: (k) => getViewsMap().has(k),
  attachView,
  onWindowClose: () => {}
})

// BrowserView 管理器的窗口依赖注入（拆分后必须在入口显式组装，否则 switchWebApp 无法工作）
initBrowserViewManager({
  getMainWindow: getMainWindowRef,
  getActiveWin: getActiveWinFromMgr,
  onWebAppSwitched: () => {},
  createEdgeWindow: (win) => createEdgeWindow(win),
  destroyEdgeWindow,
  onPageTitle: handlePageTitle
})

setToggleHandler(toggleWindowVisibility)

app.whenReady().then(async () => {
  // userData 目录搬迁（MineAI Hub → WebDock）：先同步复制关键文件，再加载设置
  const migrationPlan = buildMigrationPlan(app.getPath('appData'), app.getPath('userData'))
  await migrateUserData(migrationPlan)

  // 设置加载 + v1→v2 迁移 + 首启初始化
  const raw = await loadSettings()
  const migrated = migrateSettings(raw, PRESET_WEB_APPS)
  let settings = migrated.settings
  if (migrated.changed) {
    await saveSettings(settings)
  }

  let webApps: StoredWebApp[] = settings.webApps ?? []
  if (webApps.length === 0) {
    // 首启：写入预置模板
    webApps = PRESET_WEB_APPS.map(p => ({ ...p }))
    await saveSettings({ settingsVersion: SETTINGS_VERSION, webApps })
  }
  const appSettings = { ...DEFAULT_APP_SETTINGS, ...settings.appSettings }

  setWebApps(webApps)
  setAppSettings(appSettings)
  if (settings.shortcut) setCurrentShortcut(settings.shortcut)
  if (settings.switchShortcut) setSwitchShortcut(settings.switchShortcut)
  if (settings.windowBounds) setSavedBounds(settings.windowBounds)
  // 会话恢复：加载上次各应用的浏览位置
  setViewUrls(settings.lastUrls)

  await notifyStore.load()
  setupSessionPolicies()
  setupIPC({ notifyStore })
  createMainWindow()
  buildMenu()
  const r = registerGlobalShortcut(getCurrentShortcut())
  if (!r.ok) console.error('Failed to register global shortcut:', r.error)
  if (app.isPackaged) {
    setUpdateWindows(getMainWindowRef())
    setupAutoUpdater()
  }
})

app.on('will-quit', unregisterAllShortcuts)
app.on('before-quit', () => {
  // 置位退出标志：窗口 close 放行（否则红点关闭 = 隐藏）
  setQuittingFlag(true)
  // 持久化各应用浏览位置（重启后恢复）
  void saveSettings({ lastUrls: getViewUrls() })
  // 退出时关闭配置了 exitWithApp 的服务；按设置清空通知历史
  const exitKeys = getWebAppsList().filter(a => a.launch?.exitWithApp).map(a => a.key)
  shutdownManagedServices(exitKeys)
  if (getAppSettings().clearNotificationsOnQuit) {
    notifyStore.clearAllSync()
  }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => showMainWindow())
app.on('web-contents-created', (_e, c) => {
  if (c.getType() !== 'window') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(c as any).on('will-navigate', (ev: Event & { preventDefault: () => void }, url: string) => {
    if (url.startsWith('file://')) return
    if (import.meta.env.DEV && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return
    ev.preventDefault()
  })
})
