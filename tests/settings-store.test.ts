import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import type * as SettingsStore from '../electron/settings-store'

// 每个测试使用独立的临时目录，并通过 resetModules 重新加载模块（SETTINGS_PATH 在模块加载时求值）
let testDir: string

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => testDir
  }
}))

async function loadStore(): Promise<typeof SettingsStore> {
  vi.resetModules()
  return await import('../electron/settings-store')
}

function readSettingsFile(): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8')
  return JSON.parse(raw)
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `mineai-settings-test-${crypto.randomUUID()}`)
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('settings-store - Partial 合并', () => {
  it('只保存 windowBounds 时不应覆盖已有服务商配置（数据丢失回归）', async () => {
    const { saveSettings } = await loadStore()
    await saveSettings({ shortcut: 'Cmd+X', customProviders: [{ key: 'c1', name: 'C1', url: 'https://c1.com' }] })
    await saveSettings({ windowBounds: { x: 1, y: 2, width: 800, height: 600 } })

    const saved = readSettingsFile()
    expect(saved.windowBounds).toEqual({ x: 1, y: 2, width: 800, height: 600 })
    expect(saved.customProviders).toEqual([{ key: 'c1', name: 'C1', url: 'https://c1.com' }])
    expect(saved.shortcut).toBe('Cmd+X')
  })

  it('并发保存时字段不互相覆盖（串行队列）', async () => {
    const { saveSettings } = await loadStore()
    // 模拟真实场景：保存窗口边界与保存服务商设置几乎同时触发
    const p1 = saveSettings({ windowBounds: { x: 0, y: 0, width: 1000, height: 700 } })
    const p2 = saveSettings({ enabledProviders: ['deepseek', 'kimi'], providerOrder: ['kimi', 'deepseek'] })
    await Promise.all([p1, p2])

    const saved = readSettingsFile()
    expect(saved.windowBounds).toEqual({ x: 0, y: 0, width: 1000, height: 700 })
    expect(saved.enabledProviders).toEqual(['deepseek', 'kimi'])
    expect(saved.providerOrder).toEqual(['kimi', 'deepseek'])
  })

  it('连续三次 Partial 保存最终包含全部字段', async () => {
    const { saveSettings } = await loadStore()
    await saveSettings({ shortcut: 'Cmd+Space' })
    await saveSettings({ switchShortcut: 'Shift+Tab', mode: 'window' })
    await saveSettings({ builtInColors: { deepseek: { dark: '#000', light: '#fff' } } })

    const saved = readSettingsFile()
    expect(saved.shortcut).toBe('Cmd+Space')
    expect(saved.switchShortcut).toBe('Shift+Tab')
    expect(saved.mode).toBe('window')
    expect(saved.builtInColors).toEqual({ deepseek: { dark: '#000', light: '#fff' } })
  })
})

describe('settings-store - loadSettings', () => {
  it('文件不存在时返回 null', async () => {
    const { loadSettings } = await loadStore()
    expect(await loadSettings()).toBeNull()
  })

  it('读取已保存的设置', async () => {
    const { saveSettings, loadSettings } = await loadStore()
    await saveSettings({ mode: 'menubar', enabledProviders: null })
    const loaded = await loadSettings()
    expect(loaded?.mode).toBe('menubar')
    expect(loaded?.enabledProviders).toBeNull()
  })

  it('JSON 损坏时备份为 .bak.json 并返回 null', async () => {
    fs.writeFileSync(path.join(testDir, 'settings.json'), '{invalid json!!!')
    const { loadSettings } = await loadStore()
    expect(await loadSettings()).toBeNull()
    const backupPath = path.join(testDir, 'settings.bak.json')
    expect(fs.existsSync(backupPath)).toBe(true)
  })
})

describe('settings-store - 失败降级', () => {
  it('写入失败时不 reject，返回 { ok: false } 向上暴露', async () => {
    const { saveSettings } = await loadStore()
    // 删除目录使写入失败
    fs.rmSync(testDir, { recursive: true, force: true })
    const result = await saveSettings({ shortcut: 'Cmd+X' })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('写入成功返回 { ok: true }', async () => {
    const { saveSettings } = await loadStore()
    const result = await saveSettings({ shortcut: 'Cmd+X' })
    expect(result.ok).toBe(true)
  })
})
