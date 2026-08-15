import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as Migration from '../electron/settings-migration'

// settings-migration 依赖 settings-store（顶层 app.getPath）→ mock electron
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp/mock-userdata' }
}))

async function loadMigration(): Promise<typeof Migration> {
  vi.resetModules()
  return await import('../electron/settings-migration')
}

const PRESETS: WebAppInfo[] = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'i', color: { dark: '#151517', light: '#ffffff' }, preset: true },
  { key: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', icon: 'i', color: { dark: '#151616', light: '#ffffff' }, preset: true }
]

describe('migrateSettings - 空输入', () => {
  it('null 返回空 v2 设置（changed: false，webApps 由调用方首启填充）', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings(null, PRESETS)
    expect(r.changed).toBe(false)
    expect(r.settings.settingsVersion).toBe(2)
    expect(r.settings.webApps).toBeUndefined()
    expect(r.settings.appSettings?.notifyDefaultNative).toBe(true)
  })

  it('已是 v2 原样返回', async () => {
    const { migrateSettings } = await loadMigration()
    const input = { settingsVersion: 2, webApps: [{ key: 'x', name: 'X', url: 'https://x.com' }] }
    const r = migrateSettings(input as never, PRESETS)
    expect(r.changed).toBe(false)
    expect(r.settings).toBe(input)
  })

  it('无版本号也无旧字段：补版本号不丢字段', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({ shortcut: 'Cmd+X' } as never, PRESETS)
    expect(r.changed).toBe(true)
    expect(r.settings.settingsVersion).toBe(2)
    expect(r.settings.shortcut).toBe('Cmd+X')
  })
})

describe('migrateSettings - v1 迁移', () => {
  const v1Base = {
    shortcut: 'Cmd+Shift+Space',
    switchShortcut: 'Shift+Tab',
    windowBounds: { x: 0, y: 0, width: 1000, height: 700 },
    mode: 'window'
  }

  it('enabledProviders 过滤内置项，custom 原样带入，顺序保留', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({
      ...v1Base,
      enabledProviders: ['kimi'],
      providerOrder: ['custom1', 'kimi', 'deepseek'],
      customProviders: [{ key: 'custom1', name: 'C1', url: 'https://c1.com' }]
    } as never, PRESETS)
    expect(r.changed).toBe(true)
    expect(r.settings.settingsVersion).toBe(2)
    const keys = r.settings.webApps!.map(a => a.key)
    // providerOrder 生效：custom1 在前，kimi 其次；deepseek 被 enabled 过滤
    expect(keys).toEqual(['custom1', 'kimi'])
    const kimi = r.settings.webApps!.find(a => a.key === 'kimi')!
    expect(kimi.preset).toBe(true)
    const custom1 = r.settings.webApps!.find(a => a.key === 'custom1')!
    expect(custom1).toMatchObject({ key: 'custom1', name: 'C1', url: 'https://c1.com' })
    expect(custom1.preset).toBeUndefined()
  })

  it('enabledProviders 为 null（全部启用）时不过滤', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({ ...v1Base, enabledProviders: null } as never, PRESETS)
    expect(r.settings.webApps!.map(a => a.key)).toEqual(['deepseek', 'kimi'])
  })

  it('builtInColors 覆盖内置颜色', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({
      ...v1Base,
      builtInColors: { deepseek: { dark: '#123456', light: '#abcdef' } }
    } as never, PRESETS)
    const deepseek = r.settings.webApps!.find(a => a.key === 'deepseek')!
    expect(deepseek.color).toEqual({ dark: '#123456', light: '#abcdef' })
  })

  it('custom 的 icon/color 完整保留', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({
      ...v1Base,
      customProviders: [{ key: 'c1', name: 'C1', url: 'https://c1.com', icon: 'data:image/png;base64,AA', color: { dark: '#000', light: '#fff' } }]
    } as never, PRESETS)
    expect(r.settings.webApps!.find(a => a.key === 'c1'))
      .toMatchObject({ icon: 'data:image/png;base64,AA', color: { dark: '#000', light: '#fff' } })
  })

  it('非 v1 旧字段（仅自定义无内置）也能迁移', async () => {
    const { migrateSettings } = await loadMigration()
    const r = migrateSettings({
      customProviders: [{ key: 'c1', name: 'C1', url: 'https://c1.com' }],
      providerOrder: ['deepseek', 'c1']
    } as never, PRESETS)
    const keys = r.settings.webApps!.map(a => a.key)
    // providerOrder 中未出现的 kimi 排最后
    expect(keys).toEqual(['deepseek', 'c1', 'kimi'])
  })
})
