import { contextBridge, ipcRenderer } from 'electron'

export type UpdateStatusData = { status: string; version?: string; percent?: number; error?: string }

// 单次监听辅助：先移除旧 listener 再注册新的，防止累积
// 泛型 T 为通道负载类型，保证回调参数类型安全
function onceOn<T>(channel: string, callback: (payload: T) => void): void {
  ipcRenderer.removeAllListeners(channel)
  ipcRenderer.on(channel, (_event, payload: T) => callback(payload))
}

contextBridge.exposeInMainWorld('electronAPI', {
  switchWebApp: (key: string) => ipcRenderer.send('switch-webapp', key),
  reload: () => ipcRenderer.send('reload'),
  getMode: () => ipcRenderer.invoke('get-mode'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getCurrentWebApp: () => ipcRenderer.invoke('get-current-webapp'),
  getWebApps: () => ipcRenderer.invoke('get-webapps'),
  getWebAppSettings: () => ipcRenderer.invoke('get-webapp-settings'),
  saveWebAppSettings: (settings) => ipcRenderer.invoke('save-webapp-settings', settings),
  saveWebAppOrder: (order) => ipcRenderer.invoke('save-webapp-order', order),
  onWebAppsUpdated: (callback) => onceOn<WebAppInfo[]>('webapps-updated', callback),
  onLoading: (callback) => onceOn<{ app: string; status: string; error?: string }>('loading', callback),
  onSidebarColor: (callback) => onceOn<string>('sidebar-color', callback),
  onModeChange: (callback) => onceOn<string>('mode-changed', callback),
  onCurrentWebAppChanged: (callback) => onceOn<string>('current-webapp-changed', callback),
  onPageTitle: (callback) => onceOn<{ title: string }>('page-title', callback),
  notifySidebarState: (collapsed: boolean) => ipcRenderer.send('sidebar-state', collapsed),
  notifyThemeChange: (theme: string) => ipcRenderer.send('theme-changed', theme),
  onExitFocusMode: (callback) => onceOn<void>('exit-focus-mode', callback),
  getShortcut: () => ipcRenderer.invoke('get-shortcut'),
  setShortcut: (acc: string) => ipcRenderer.invoke('set-shortcut', acc),
  getSwitchShortcut: () => ipcRenderer.invoke('get-switch-shortcut'),
  setSwitchShortcut: (acc: string) => ipcRenderer.invoke('set-switch-shortcut', acc),
  toggleSettings: (show: boolean) => ipcRenderer.send('toggle-settings', show),
  fetchFavicon: (url: string) => ipcRenderer.invoke('fetch-favicon', url),
  fetchIconUrl: (url: string) => ipcRenderer.invoke('fetch-icon-url', url),
  fetchPageMeta: (url: string) => ipcRenderer.invoke('fetch-page-meta', url),
  // 本地服务拉起
  ensureServiceUp: (key: string) => ipcRenderer.invoke('ensure-service-up', key),
  getServiceStatus: (key: string) => ipcRenderer.invoke('get-service-status', key),
  stopService: (key: string) => ipcRenderer.invoke('stop-service', key),
  // 数据导入导出
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  // 自动更新
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => onceOn<UpdateStatusData>('update-status', callback)
} satisfies ElectronAPI)
