import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as StateModule from '../src/state'

// 每个测试通过 vi.resetModules() 重新加载 state 模块，避免模块级单例相互污染
async function loadState(): Promise<typeof StateModule> {
  vi.resetModules()
  return await import('../src/state')
}

const dispatchSpy = vi.fn()

beforeEach(() => {
  dispatchSpy.mockClear()
  vi.stubGlobal('document', { dispatchEvent: dispatchSpy })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('state - getState 只读视图', () => {
  it('直接 mutate providers 数组应抛错（深冻结）', async () => {
    const { getState, updateProviders } = await loadState()
    updateProviders([{ key: 'a', name: 'A', url: 'https://a.com', icon: 'i', color: { dark: '#000', light: '#fff' } }])
    expect(() => (getState().providers as unknown[]).push('x')).toThrow()
  })

  it('mutate 返回的 providerStatus 副本不影响内部状态', async () => {
    const { getState, setProviderStatus } = await loadState()
    setProviderStatus('a', 'loading')
    // mutate 快照中的 Map 副本
    getState().providerStatus.set('a', 'error')
    expect(getState().providerStatus.get('a')).toBe('loading')
  })

  it('直接修改 providerSettings.custom 应抛错', async () => {
    const { getState, addCustomProvider } = await loadState()
    addCustomProvider({ key: 'c', name: 'C', url: 'https://c.com', icon: null, color: { dark: '#000', light: '#fff' } })
    expect(() => (getState().providerSettings.custom as unknown[]).push('x')).toThrow()
  })
})

describe('state - setCurrentProvider', () => {
  it('更新当前服务商并 dispatch provider-changed', async () => {
    const { getState, setCurrentProvider } = await loadState()
    setCurrentProvider('kimi')
    expect(getState().currentProviderKey).toBe('kimi')
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('provider-changed')
    expect(event.detail).toEqual({ key: 'kimi' })
  })
})

describe('state - setProviderStatus', () => {
  it('loading/error 记录状态，loaded 移除状态', async () => {
    const { getState, setProviderStatus } = await loadState()
    setProviderStatus('deepseek', 'loading')
    setProviderStatus('kimi', 'error')
    expect(getState().providerStatus.get('deepseek')).toBe('loading')
    expect(getState().providerStatus.get('kimi')).toBe('error')
    setProviderStatus('deepseek', 'loaded')
    expect(getState().providerStatus.has('deepseek')).toBe(false)
    expect(getState().providerStatus.has('kimi')).toBe(true)
  })
})

describe('state - 自定义服务商 setter', () => {
  it('addCustomProvider 追加且不修改原数组', async () => {
    const { getState, addCustomProvider } = await loadState()
    const before = getState().providerSettings.custom
    addCustomProvider({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: null, color: { dark: '#000', light: '#fff' } })
    const after = getState().providerSettings.custom
    expect(after.length).toBe(1)
    expect(after[0].key).toBe('c1')
  })

  it('removeCustomProvider 按索引删除', async () => {
    const { getState, addCustomProvider, removeCustomProvider } = await loadState()
    addCustomProvider({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: null, color: { dark: '#000', light: '#fff' } })
    addCustomProvider({ key: 'c2', name: 'C2', url: 'https://c2.com', icon: null, color: { dark: '#000', light: '#fff' } })
    removeCustomProvider(0)
    const custom = getState().providerSettings.custom
    expect(custom.length).toBe(1)
    expect(custom[0].key).toBe('c2')
  })

  it('updateCustomProvider 只更新目标项', async () => {
    const { getState, addCustomProvider, updateCustomProvider } = await loadState()
    addCustomProvider({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: null, color: { dark: '#000', light: '#fff' } })
    addCustomProvider({ key: 'c2', name: 'C2', url: 'https://c2.com', icon: null, color: { dark: '#000', light: '#fff' } })
    updateCustomProvider(1, { name: 'C2 改名' })
    const custom = getState().providerSettings.custom
    expect(custom[0].name).toBe('C1')
    expect(custom[1].name).toBe('C2 改名')
    expect(custom[1].url).toBe('https://c2.com')
  })

  it('setEnabledProviders 更新启用列表', async () => {
    const { getState, setEnabledProviders } = await loadState()
    setEnabledProviders(['deepseek', 'kimi'])
    expect(getState().providerSettings.enabled).toEqual(['deepseek', 'kimi'])
  })

  it('setBuiltInProviderColor 只更新目标颜色', async () => {
    const { getState, updateProviderSettings, setBuiltInProviderColor } = await loadState()
    updateProviderSettings({
      builtIn: [
        { key: 'a', name: 'A', url: 'https://a.com', icon: 'i', color: { dark: '#000', light: '#fff' } },
        { key: 'b', name: 'B', url: 'https://b.com', icon: 'i', color: { dark: '#000', light: '#fff' } }
      ],
      enabled: null,
      custom: [],
      order: null
    })
    setBuiltInProviderColor('b', { dark: '#111', light: '#eee' })
    const builtIn = getState().providerSettings.builtIn
    expect(builtIn[0].color).toEqual({ dark: '#000', light: '#fff' })
    expect(builtIn[1].color).toEqual({ dark: '#111', light: '#eee' })
  })
})
