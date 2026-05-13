import { contextBridge, ipcRenderer } from 'electron'

export interface ProvidersUpdatedCallback {
  (providers: ProviderInfo[]): void
}

export interface LoadingCallback {
  (data: { provider: string; status: string; error?: string }): void
}

export interface VoidCallback {
  (): void
}

export interface StringCallback {
  (s: string): void
}

export interface ModeCallback {
  (mode: string): void
}

export interface UpdateStatusCallback {
  (data: { status: string; version?: string; percent?: number; error?: string }): void
}

export interface ProviderInfo {
  key: string
  name: string
  url: string
  icon: string
  color?: { dark: string; light: string }
}

export interface ProviderSettings {
  builtIn: Array<{ key: string; name: string; url: string; icon: string; color?: { dark: string; light: string } }>
  enabled: string[] | null
  custom: ProviderInfo[]
  order: string[] | null
}

export interface ElectronAPI {
  switchProvider: (key: string) => void
  reload: () => void
  toggleMode: () => Promise<string>
  getMode: () => Promise<string>
  getVersion: () => Promise<string>
  getCurrentProvider: () => Promise<string>
  getProviders: () => Promise<ProviderInfo[]>
  getProviderSettings: () => Promise<ProviderSettings>
  saveProviderSettings: (settings: { enabled: string[] | null; custom: ProviderInfo[]; builtInColors?: Record<string, { dark: string; light: string }> }) => Promise<void>
  saveProviderOrder: (order: string[]) => Promise<void>
  onProvidersUpdated: (callback: ProvidersUpdatedCallback) => void
  onLoading: (callback: LoadingCallback) => void
  onSidebarColor: (callback: StringCallback) => void
  onModeChange: (callback: ModeCallback) => void
  notifySidebarState: (collapsed: boolean) => void
  notifyThemeChange: (theme: string) => void
  onExitFocusMode: (callback: VoidCallback) => void
  getShortcut: () => Promise<string>
  setShortcut: (acc: string) => Promise<{ ok: boolean; error?: string }>
  getSwitchShortcut: () => Promise<string>
  setSwitchShortcut: (acc: string) => Promise<{ ok: boolean; error?: string }>
  toggleSettings: (show: boolean) => void
  injectClipboard: () => Promise<{ ok: boolean; error?: string }>
  fetchFavicon: (url: string) => Promise<string | null>
  fetchIconUrl: (url: string) => Promise<string | null>
  checkUpdate: () => Promise<{ ok: boolean; hasUpdate?: boolean; error?: string }>
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
  installUpdate: () => void
  onUpdateStatus: (callback: UpdateStatusCallback) => void
}

contextBridge.exposeInMainWorld('electronAPI', {
  switchProvider: (key: string) => ipcRenderer.send('switch-provider', key),
  reload: () => ipcRenderer.send('reload'),
  toggleMode: () => ipcRenderer.invoke('toggle-mode'),
  getMode: () => ipcRenderer.invoke('get-mode'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getCurrentProvider: () => ipcRenderer.invoke('get-current-provider'),
  getProviders: () => ipcRenderer.invoke('get-providers'),
  getProviderSettings: () => ipcRenderer.invoke('get-provider-settings'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('save-provider-settings', settings),
  saveProviderOrder: (order) => ipcRenderer.invoke('save-provider-order', order),
  onProvidersUpdated: (callback) => {
    ipcRenderer.on('providers-updated', (_event, providers) => callback(providers))
  },
  onLoading: (callback) => {
    ipcRenderer.on('loading', (_event, data) => callback(data))
  },
  onSidebarColor: (callback) => {
    ipcRenderer.on('sidebar-color', (_event, color) => callback(color))
  },
  onModeChange: (callback) => {
    ipcRenderer.on('mode-changed', (_event, mode) => callback(mode))
  },
  notifySidebarState: (collapsed: boolean) => ipcRenderer.send('sidebar-state', collapsed),
  notifyThemeChange: (theme: string) => ipcRenderer.send('theme-changed', theme),
  onExitFocusMode: (callback) => {
    ipcRenderer.on('exit-focus-mode', () => callback())
  },
  getShortcut: () => ipcRenderer.invoke('get-shortcut'),
  setShortcut: (acc: string) => ipcRenderer.invoke('set-shortcut', acc),
  getSwitchShortcut: () => ipcRenderer.invoke('get-switch-shortcut'),
  setSwitchShortcut: (acc: string) => ipcRenderer.invoke('set-switch-shortcut', acc),
  toggleSettings: (show: boolean) => ipcRenderer.send('toggle-settings', show),
  injectClipboard: () => ipcRenderer.invoke('inject-clipboard'),
  fetchFavicon: (url: string) => ipcRenderer.invoke('fetch-favicon', url),
  fetchIconUrl: (url: string) => ipcRenderer.invoke('fetch-icon-url', url),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data))
  }
} satisfies ElectronAPI)
