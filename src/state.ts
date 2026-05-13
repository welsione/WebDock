export type ProviderStatusMap = Map<string, 'loading' | 'error'>

interface AppState {
  providers: ProviderInfo[]
  currentProviderKey: string
  providerStatus: ProviderStatusMap
  providerSettings: ProviderSettings
  switchShortcut: string
}

const state: AppState = {
  providers: [],
  currentProviderKey: 'deepseek',
  providerStatus: new Map(),
  providerSettings: { builtIn: [], enabled: null, custom: [], order: null },
  switchShortcut: 'Shift+Tab'
}

export function getState() {
  return state
}

export function setCurrentProvider(key: string) {
  state.currentProviderKey = key
  document.dispatchEvent(new CustomEvent('provider-changed', { detail: { key } }))
}

export function updateProviders(providers: ProviderInfo[]) {
  state.providers = providers
}

export function updateProviderSettings(settings: ProviderSettings) {
  state.providerSettings = settings
}

export function setSwitchShortcut(shortcut: string) {
  state.switchShortcut = shortcut
}
