import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as Bvm from '../electron/browser-view-manager'

// getMergedWebApps 依赖 config（模块加载时读真实 assets 图标）与 icons（nativeImage）
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

describe('getMergedWebApps - 默认状态', () => {
  it('未设置时返回空列表（首启由 main 写入预置模板）', async () => {
    const { getMergedWebApps } = await loadBvm()
    expect(getMergedWebApps()).toEqual([])
  })
})

describe('getMergedWebApps - icon/color 回退', () => {
  it('缺少 icon 时回退为首字母图标', async () => {
    const { getMergedWebApps, setWebApps } = await loadBvm()
    setWebApps([{ key: 'c1', name: 'ChatGPT', url: 'https://chat.openai.com' }])
    expect(getMergedWebApps()[0].icon).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('缺少 color 时回退为默认色', async () => {
    const { getMergedWebApps, setWebApps } = await loadBvm()
    setWebApps([{ key: 'c1', name: 'C1', url: 'https://c1.com' }])
    expect(getMergedWebApps()[0].color).toEqual({ dark: '#1a1e28', light: '#f0f2f5' })
  })

  it('保留自定义 icon/color/notify/launch 等字段', async () => {
    const { getMergedWebApps, setWebApps } = await loadBvm()
    setWebApps([{
      key: 'c1', name: 'C1', url: 'https://c1.com',
      icon: 'data:image/png;base64,XXX',
      color: { dark: '#111', light: '#eee' },
      notify: { native: false, titleNotify: true },
      launch: { command: 'dsh web' },
      trustCertificate: true,
      preset: true
    }])
    const app = getMergedWebApps()[0]
    expect(app).toMatchObject({
      key: 'c1', name: 'C1', url: 'https://c1.com',
      icon: 'data:image/png;base64,XXX',
      color: { dark: '#111', light: '#eee' },
      notify: { native: false, titleNotify: true },
      launch: { command: 'dsh web' },
      trustCertificate: true,
      preset: true
    })
  })
})

describe('getMergedWebApps - 列表顺序', () => {
  it('保持 setWebApps 传入顺序（排序由调用方负责）', async () => {
    const { getMergedWebApps, setWebApps } = await loadBvm()
    setWebApps([
      { key: 'b', name: 'B', url: 'https://b.com' },
      { key: 'a', name: 'A', url: 'https://a.com' }
    ])
    expect(getMergedWebApps().map(p => p.key)).toEqual(['b', 'a'])
  })
})

describe('getPresetWebApps - 预置模板', () => {
  it('返回 7 个预置且均带 preset 标记', async () => {
    const { getPresetWebApps } = await loadBvm()
    const presets = getPresetWebApps()
    expect(presets.length).toBe(7)
    expect(presets.every(p => p.preset === true)).toBe(true)
    expect(presets[0].key).toBe('deepseek')
  })
})
