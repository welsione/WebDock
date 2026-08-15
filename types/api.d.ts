// ===== 全局类型声明（WebDock） =====
// 渲染进程和主进程共享的接口定义。
// 注意：preload.ts 中 export 的接口与此处保持一致（双份同步，避免跨 project 引用）。

interface WebAppColor {
  dark: string
  light: string
}

/** 每应用通知策略 */
interface WebAppNotify {
  /** 是否转发 macOS 系统通知 */
  native: boolean
  /** 页面标题变化 → 应用内通知（opt-in，防误报） */
  titleNotify: boolean
}

/** 每应用权限（三态；默认 deny） */
interface WebAppPermissions {
  camera: 'allow' | 'ask' | 'deny'
  microphone: 'allow' | 'ask' | 'deny'
  geolocation: 'allow' | 'ask' | 'deny'
}

/** 本地服务拉起配置（如 `dsh web`、`ollama serve`） */
interface WebAppLaunch {
  /** 启动命令（shell 字符串，支持 cd && ...） */
  command: string
  /** 工作目录（可选） */
  cwd?: string
  /** 健康检查地址（默认 = url） */
  healthUrl?: string
  /** 退出 WebDock 时是否关闭此服务（默认 false：只拉起不关闭） */
  exitWithApp?: boolean
}

interface WebAppInfo {
  key: string
  name: string
  url: string
  icon: string
  color: WebAppColor
  notify?: WebAppNotify
  permissions?: WebAppPermissions
  /** 信任自签名证书（本地 https 服务场景） */
  trustCertificate?: boolean
  /** 本地服务拉起配置 */
  launch?: WebAppLaunch
  /** 预置模板标记（可编辑/删除） */
  preset?: boolean
}

/** 全局应用设置 */
interface AppSettings {
  /** 默认是否转发系统通知 */
  notifyDefaultNative: boolean
  /** 音频独占：仅当前应用发声 */
  audioExclusive: boolean
  /** 视图缓存上限（0 = 不限制） */
  viewCacheLimit: number
  /** 退出时清空通知历史 */
  clearNotificationsOnQuit: boolean
}

/** 通知收件箱条目 */
interface NotificationItem {
  id: string
  appKey: string
  title: string
  body: string
  /** 时间戳（ms） */
  time: number
  read: boolean
  kind: 'notification' | 'title'
}

interface WebAppSettings {
  webApps: WebAppInfo[]
  appSettings: AppSettings
}

interface NotificationReadScope {
  all?: boolean
  app?: string
  id?: string
}

interface ElectronAPI {
  switchWebApp: (key: string) => void
  reload: () => void
  getMode: () => Promise<string>
  getVersion: () => Promise<string>
  getCurrentWebApp: () => Promise<string>
  getWebApps: () => Promise<WebAppInfo[]>
  getWebAppSettings: () => Promise<WebAppSettings>
  saveWebAppSettings: (settings: WebAppSettings) => Promise<void>
  saveWebAppOrder: (order: string[]) => Promise<void>
  onWebAppsUpdated: (callback: (apps: WebAppInfo[]) => void) => void
  onLoading: (callback: (data: { app: string; status: string; error?: string }) => void) => void
  onSidebarColor: (callback: (color: string) => void) => void
  onModeChange: (callback: (mode: string) => void) => void
  onCurrentWebAppChanged: (callback: (key: string) => void) => void
  onPageTitle: (callback: (data: { title: string }) => void) => void
  notifySidebarState: (collapsed: boolean) => void
  notifyThemeChange: (theme: string) => void
  onExitFocusMode: (callback: () => void) => void
  getShortcut: () => Promise<string>
  setShortcut: (acc: string) => Promise<{ ok: boolean; error?: string }>
  getSwitchShortcut: () => Promise<string>
  setSwitchShortcut: (acc: string) => Promise<{ ok: boolean; error?: string }>
  toggleSettings: (show: boolean) => void
  fetchFavicon: (url: string) => Promise<string | null>
  fetchIconUrl: (url: string) => Promise<string | null>
  fetchPageMeta: (url: string) => Promise<{ title: string | null; icon: string | null }>
  // 本地服务拉起
  ensureServiceUp: (key: string) => Promise<{ ok: boolean; launched?: boolean; error?: string }>
  getServiceStatus: (key: string) => Promise<{ running: boolean; pid?: number | null }>
  stopService: (key: string) => Promise<{ ok: boolean; error?: string }>
  // 数据导入导出
  exportData: () => Promise<{ ok: boolean; error?: string }>
  importData: () => Promise<{ ok: boolean; error?: string }>
  // 自动更新
  checkUpdate: () => Promise<{ ok: boolean; hasUpdate?: boolean; error?: string }>
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
  installUpdate: () => Promise<void>
  onUpdateStatus: (callback: (data: { status: string; version?: string; percent?: number; error?: string }) => void) => void
}

interface EdgeAPI {
  exitFocus: () => void
  moveWindow: (dx: number, dy: number) => void
  onThemeChange: (callback: (theme: string) => void) => void
}

interface Window {
  electronAPI: ElectronAPI
  edgeAPI: EdgeAPI
}
