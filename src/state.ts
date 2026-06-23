export type ProviderStatusMap = Map<string, 'loading' | 'error'>

interface AppState {
  providers: ReadonlyArray<ProviderInfo>
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

/** 返回状态的只读快照（浅冻结） */
export function getState(): Readonly<AppState> {
  return state
}

export function setCurrentProvider(key: string): void {
  state.currentProviderKey = key
  document.dispatchEvent(new CustomEvent('provider-changed', { detail: { key } }))
}

export function updateProviders(providers: ProviderInfo[]): void {
  state.providers = Object.freeze(providers)
}

export function updateProviderSettings(settings: ProviderSettings): void {
  state.providerSettings = settings
}

export function setSwitchShortcut(shortcut: string): void {
  state.switchShortcut = shortcut
}

/** 添加自定义服务商（通过 setter 而非直接 push） */
export function addCustomProvider(provider: { key: string; name: string; url: string; icon: string | null; color: { dark: string; light: string } }): void {
  state.providerSettings = {
    ...state.providerSettings,
    custom: [...state.providerSettings.custom, provider]
  }
}

/** 删除自定义服务商（通过 setter 而非直接 splice） */
export function removeCustomProvider(index: number): void {
  state.providerSettings = {
    ...state.providerSettings,
    custom: state.providerSettings.custom.filter((_, i) => i !== index)
  }
}

/** 更新内置服务商启用列表 */
export function setEnabledProviders(enabled: string[]): void {
  state.providerSettings = {
    ...state.providerSettings,
    enabled
  }
}

/** 更新内置服务商颜色 */
export function setBuiltInProviderColor(key: string, color: { dark: string; light: string }): void {
  const builtIn = state.providerSettings.builtIn.map(p =>
    p.key === key ? { ...p, color } : p
  )
  state.providerSettings = {
    ...state.providerSettings,
    builtIn
  }
}

/** 更新自定义服务商信息 */
export function updateCustomProvider(index: number, updates: Partial<{ name: string; url: string; icon: string | null; color: { dark: string; light: string } }>): void {
  const custom = state.providerSettings.custom.map((p, i) =>
    i === index ? { ...p, ...updates } : p
  )
  state.providerSettings = {
    ...state.providerSettings,
    custom
  }
}
