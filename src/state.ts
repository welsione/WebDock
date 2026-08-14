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
 * - Map/Set 无法通过 Object.freeze 防写，因此 providerStatus 返回副本，mutate 副本不影响内部状态
 * - setter 通过替换引用更新内部状态，与快照互不干扰
 */
export function getState(): Readonly<AppState> {
  return deepFreeze({
    providers: state.providers,
    currentProviderKey: state.currentProviderKey,
    providerStatus: new Map(state.providerStatus),
    providerSettings: {
      builtIn: [...state.providerSettings.builtIn],
      enabled: state.providerSettings.enabled ? [...state.providerSettings.enabled] : null,
      custom: [...state.providerSettings.custom],
      order: state.providerSettings.order ? [...state.providerSettings.order] : null
    },
    switchShortcut: state.switchShortcut
  })
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

/** 更新服务商加载状态（替换 Map 引用，避免 mutate 冻结对象） */
export function setProviderStatus(key: string, status: 'loading' | 'error' | 'loaded'): void {
  const next = new Map(state.providerStatus)
  if (status === 'loaded') {
    next.delete(key)
  } else {
    next.set(key, status)
  }
  state.providerStatus = next
}

/** 添加自定义服务商（通过 setter 而非直接 push） */
export function addCustomProvider(provider: { key: string; name: string; url: string; icon: string | null; color: { dark: string; light: string } }): void {
  state.providerSettings = {
    ...state.providerSettings,
    custom: [...state.providerSettings.custom, provider]
  }
}

/** 删除自定义服务商（按 key 定位——渲染快照中的 index 在拖拽/多次删除后会漂移，禁止用 index） */
export function removeCustomProvider(key: string): void {
  state.providerSettings = {
    ...state.providerSettings,
    custom: state.providerSettings.custom.filter(p => p.key !== key)
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

/** 更新自定义服务商（按 key 定位，理由同 removeCustomProvider） */
export function updateCustomProvider(key: string, updates: Partial<{ name: string; url: string; icon: string | null; color: { dark: string; light: string } }>): void {
  const custom = state.providerSettings.custom.map(p =>
    p.key === key ? { ...p, ...updates } : p
  )
  state.providerSettings = {
    ...state.providerSettings,
    custom
  }
}
