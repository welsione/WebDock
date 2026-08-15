export type AppStatusMap = Map<string, 'loading' | 'error' | 'starting'>

interface AppState {
  webApps: ReadonlyArray<WebAppInfo>
  currentWebAppKey: string
  appStatus: AppStatusMap
  webAppSettings: WebAppSettings
  switchShortcut: string
  notifications: ReadonlyArray<NotificationItem>
}

const state: AppState = {
  webApps: [],
  currentWebAppKey: 'deepseek',
  appStatus: new Map(),
  webAppSettings: {
    webApps: [],
    appSettings: { notifyDefaultNative: true, audioExclusive: true, viewCacheLimit: 0, clearNotificationsOnQuit: false }
  },
  switchShortcut: 'Shift+Tab',
  notifications: []
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj)
    for (const key of Object.keys(obj as object)) {
      deepFreeze((obj as Record<string, unknown>)[key])
    }
  }
  return obj
}

/**
 * 返回状态的只读快照（副本隔离）：
 * - 每次调用创建新对象并深冻结，调用方 mutate（push/set/赋值）会在严格模式下抛错
 * - Map/Set 无法通过 Object.freeze 防写，因此 appStatus 返回副本，mutate 副本不影响内部状态
 * - setter 通过替换引用更新内部状态，与快照互不干扰
 */
export function getState(): Readonly<AppState> {
  return deepFreeze({
    webApps: state.webApps,
    currentWebAppKey: state.currentWebAppKey,
    appStatus: new Map(state.appStatus),
    webAppSettings: {
      webApps: [...state.webAppSettings.webApps],
      appSettings: { ...state.webAppSettings.appSettings }
    },
    switchShortcut: state.switchShortcut,
    notifications: [...state.notifications]
  })
}

export function setCurrentWebApp(key: string): void {
  state.currentWebAppKey = key
  document.dispatchEvent(new CustomEvent('webapp-changed', { detail: { key } }))
}

export function updateWebApps(apps: WebAppInfo[]): void {
  state.webApps = Object.freeze(apps)
}

export function updateWebAppSettings(settings: WebAppSettings): void {
  state.webAppSettings = settings
}

export function setSwitchShortcut(shortcut: string): void {
  state.switchShortcut = shortcut
}

/** 更新网页应用加载状态（替换 Map 引用，避免 mutate 冻结对象） */
export function setAppStatus(key: string, status: 'loading' | 'error' | 'loaded' | 'starting'): void {
  const next = new Map(state.appStatus)
  if (status === 'loaded') {
    next.delete(key)
  } else {
    next.set(key, status)
  }
  state.appStatus = next
}

/** 添加网页应用（通过 setter 而非直接 push） */
export function addWebApp(app: WebAppInfo): void {
  state.webAppSettings = {
    ...state.webAppSettings,
    webApps: [...state.webAppSettings.webApps, app]
  }
}

/** 删除网页应用（按 key 定位——渲染快照中的 index 在拖拽/多次删除后会漂移，禁止用 index） */
export function removeWebApp(key: string): void {
  state.webAppSettings = {
    ...state.webAppSettings,
    webApps: state.webAppSettings.webApps.filter(p => p.key !== key)
  }
}

/** 更新网页应用（按 key 定位，理由同 removeWebApp） */
export function updateWebApp(key: string, updates: Partial<WebAppInfo>): void {
  const webApps = state.webAppSettings.webApps.map(p =>
    p.key === key ? { ...p, ...updates } : p
  )
  state.webAppSettings = {
    ...state.webAppSettings,
    webApps
  }
}

/** 更新全局应用设置 */
export function updateAppSettings(patch: Partial<AppSettings>): void {
  state.webAppSettings = {
    ...state.webAppSettings,
    appSettings: { ...state.webAppSettings.appSettings, ...patch }
  }
}

// ===== 通知收件箱 =====
export function setNotifications(list: NotificationItem[]): void {
  state.notifications = Object.freeze([...list])
}

export function addNotification(item: NotificationItem): void {
  state.notifications = Object.freeze([item, ...state.notifications])
}

/** 标记已读（全部/应用/单条） */
export function markNotificationsRead(scope: NotificationReadScope): void {
  state.notifications = Object.freeze(
    state.notifications.map(i => {
      const hit = scope.all || (scope.app !== undefined && i.appKey === scope.app) || (scope.id !== undefined && i.id === scope.id)
      return hit && !i.read ? { ...i, read: true } : i
    })
  )
}

export function clearNotifications(scope: NotificationReadScope): void {
  state.notifications = Object.freeze(
    scope.all ? [] : scope.app !== undefined
      ? state.notifications.filter(i => i.appKey !== scope.app)
      : state.notifications
  )
}

export function unreadCount(): number {
  return state.notifications.filter(i => !i.read).length
}

/** 每应用未读数 */
export function unreadByApp(): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of state.notifications) {
    if (!i.read) m.set(i.appKey, (m.get(i.appKey) ?? 0) + 1)
  }
  return m
}
