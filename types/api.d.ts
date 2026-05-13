interface ProviderInfo {
  key: string
  name: string
  url: string
  icon: string | null
  color?: { dark: string; light: string }
}

interface ProviderColor {
  dark: string
  light: string
}

interface ProviderSettings {
  builtIn: Array<{ key: string; name: string; url: string; icon: string; color?: { dark: string; light: string } }>
  enabled: string[] | null
  custom: ProviderInfo[]
  order: string[] | null
}

interface ElectronAPI {
  switchProvider: (key: string) => void
  reload: () => void
  toggleMode: () => Promise<string>
  getMode: () => Promise<string>
  getVersion: () => Promise<string>
  getCurrentProvider: () => Promise<string>
  getProviders: () => Promise<ProviderInfo[]>
  getProviderSettings: () => Promise<ProviderSettings>
  saveProviderSettings: (settings: {
    enabled: string[] | null
    custom: ProviderInfo[]
    builtInColors?: Record<string, { dark: string; light: string }>
  }) => Promise<void>
  saveProviderOrder: (order: string[]) => Promise<void>
  onProvidersUpdated: (callback: (providers: ProviderInfo[]) => void) => void
  onLoading: (callback: (data: { provider: string; status: string; error?: string }) => void) => void
  onSidebarColor: (callback: (color: string) => void) => void
  onModeChange: (callback: (mode: string) => void) => void
  notifySidebarState: (collapsed: boolean) => void
  notifyThemeChange: (theme: string) => void
  onExitFocusMode: (callback: () => void) => void
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
