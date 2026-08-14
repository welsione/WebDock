import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as Bvm from '../electron/browser-view-manager'

// getMergedProviders 依赖 config（模块加载时读真实 assets 图标）与 icons（nativeImage）
// 只 mock electron 的窗口/通知相关类，fs/path 用真实实现（assets 目录真实存在）
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/mock-userdata' },
  BrowserWindow: class {},
  BrowserView: class {},
  shell: {},
  nativeImage: {
    createFromBuffer: () => ({ toDataURL: () => 'data:image/png;base64,FAKE_ICON' }),
    createFromDataURL: () => ({ toDataURL: () => 'data:image/png;base64,FAKE_ICON' })
  },
  Notification: class {},
  session: { defaultSession: { setPermissionRequestHandler: () => {} } },
  webContents: { getAllWebContents: () => [] }
}))

async function loadBvm(): Promise<typeof Bvm> {
  vi.resetModules()
  return await import('../electron/browser-view-manager')
}

beforeEach(() => {
  vi.resetModules()
})

describe('getMergedProviders - 默认状态', () => {
  it('无过滤时返回全部内置服务商，顺序与 PROVIDERS 一致', async () => {
    const { getMergedProviders } = await loadBvm()
    const providers = getMergedProviders()
    expect(providers.length).toBe(7)
    expect(providers[0].key).toBe('deepseek')
    expect(providers.map(p => p.key)).toEqual(['deepseek', 'doubao', 'kimi', 'metaso', 'qianwen', 'minimax', 'zhipu'])
  })

  it('内置服务商 icon 非空且 color 完整', async () => {
    const { getMergedProviders } = await loadBvm()
    for (const p of getMergedProviders()) {
      expect(p.icon).toBeTruthy()
      expect(p.color.dark).toBeTruthy()
      expect(p.color.light).toBeTruthy()
    }
  })
})

describe('getMergedProviders - 启用过滤', () => {
  it('enabledProviders 过滤内置服务商', async () => {
    const { getMergedProviders, setEnabledProviders } = await loadBvm()
    setEnabledProviders(['deepseek', 'kimi'])
    const keys = getMergedProviders().map(p => p.key)
    expect(keys).toEqual(['deepseek', 'kimi'])
  })

  it('enabledProviders 为空数组时返回空列表', async () => {
    const { getMergedProviders, setEnabledProviders } = await loadBvm()
    setEnabledProviders([])
    expect(getMergedProviders().length).toBe(0)
  })
})

describe('getMergedProviders - 自定义服务商合并', () => {
  it('自定义服务商追加到内置之后', async () => {
    const { getMergedProviders, setCustomProviders } = await loadBvm()
    setCustomProviders([{ key: 'c1', name: 'C1', url: 'https://c1.com', icon: 'data:image/png;base64,XXX' }])
    const providers = getMergedProviders()
    expect(providers.length).toBe(8)
    expect(providers[7]).toMatchObject({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: 'data:image/png;base64,XXX' })
  })

  it('自定义服务商缺少 icon 时回退为首字母图标', async () => {
    const { getMergedProviders, setCustomProviders } = await loadBvm()
    setCustomProviders([{ key: 'c1', name: 'ChatGPT', url: 'https://chat.openai.com' }])
    const providers = getMergedProviders()
    expect(providers[7].icon).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('自定义服务商缺少 color 时回退为默认色', async () => {
    const { getMergedProviders, setCustomProviders } = await loadBvm()
    setCustomProviders([{ key: 'c1', name: 'C1', url: 'https://c1.com' }])
    expect(getMergedProviders()[7].color).toEqual({ dark: '#1a1e28', light: '#f0f2f5' })
  })

  it('自定义服务商保留自己的 color', async () => {
    const { getMergedProviders, setCustomProviders } = await loadBvm()
    setCustomProviders([{ key: 'c1', name: 'C1', url: 'https://c1.com', color: { dark: '#111', light: '#eee' } }])
    expect(getMergedProviders()[7].color).toEqual({ dark: '#111', light: '#eee' })
  })
})

describe('getMergedProviders - 排序', () => {
  it('providerOrder 生效，未出现的 key 排最后', async () => {
    const { getMergedProviders, setProviderOrder } = await loadBvm()
    setProviderOrder(['kimi', 'deepseek', 'nonexistent'])
    const keys = getMergedProviders().map(p => p.key)
    expect(keys[0]).toBe('kimi')
    expect(keys[1]).toBe('deepseek')
    // 'nonexistent' 不在列表中；其余按默认顺序排在最后
    expect(keys.slice(2)).toEqual(['doubao', 'metaso', 'qianwen', 'minimax', 'zhipu'])
  })

  it('自定义服务商参与排序', async () => {
    const { getMergedProviders, setProviderOrder, setCustomProviders } = await loadBvm()
    setCustomProviders([{ key: 'c1', name: 'C1', url: 'https://c1.com' }])
    setProviderOrder(['c1', 'deepseek'])
    const keys = getMergedProviders().map(p => p.key)
    expect(keys[0]).toBe('c1')
    expect(keys[1]).toBe('deepseek')
  })
})

describe('getMergedProviders - 内置颜色覆盖', () => {
  it('builtInColors 覆盖内置服务商颜色', async () => {
    const { getMergedProviders, setBuiltInColors } = await loadBvm()
    setBuiltInColors({ deepseek: { dark: '#123456', light: '#abcdef' } })
    const deepseek = getMergedProviders().find(p => p.key === 'deepseek')!
    expect(deepseek.color).toEqual({ dark: '#123456', light: '#abcdef' })
  })
})
