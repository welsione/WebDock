import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import type * as IconsModule from '../electron/icons'

// nativeImage.createFromBuffer 仅支持 PNG/JPEG（对 SVG buffer 返回空图像），
// 因此 generateLetterIcon 直接返回 SVG data URL，不依赖 nativeImage
const createFromBufferMock = vi.fn(() => ({
  isEmpty: () => false,
  toDataURL: () => 'data:image/png;base64,QUJD'
}))

let testDir: string

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => testDir },
  nativeImage: {
    createFromBuffer: createFromBufferMock,
    createFromDataURL: vi.fn(() => ({ toDataURL: () => 'data:image/png;base64,AA==' }))
  }
}))

async function loadIcons(): Promise<typeof IconsModule> {
  vi.resetModules()
  return await import('../electron/icons')
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `mineai-icons-test-${crypto.randomUUID()}`)
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('generateLetterIcon', () => {
  it('返回合法的 SVG data URL', async () => {
    const { generateLetterIcon } = await loadIcons()
    const result = generateLetterIcon('TestProvider')
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('图标内容包含名称首字母', async () => {
    const { generateLetterIcon } = await loadIcons()
    const result = generateLetterIcon('ChatGPT')
    const decoded = Buffer.from(result.split(',')[1], 'base64').toString()
    expect(decoded).toContain('>C<')
  })

  it('不同名称生成不同图标', async () => {
    const { generateLetterIcon } = await loadIcons()
    expect(generateLetterIcon('A')).not.toBe(generateLetterIcon('B'))
  })

  it('空名称使用问号占位', async () => {
    const { generateLetterIcon } = await loadIcons()
    const result = generateLetterIcon('')
    const decoded = Buffer.from(result.split(',')[1], 'base64').toString()
    expect(decoded).toContain('>?<')
  })

  it('不依赖 nativeImage（SVG 不走 createFromBuffer）', async () => {
    const { generateLetterIcon } = await loadIcons()
    generateLetterIcon('X')
    expect(createFromBufferMock).not.toHaveBeenCalled()
  })
})

describe('dataUrlToNativeImage', () => {
  it('非 data URL 返回 null', async () => {
    const { dataUrlToNativeImage } = await loadIcons()
    expect(dataUrlToNativeImage('https://example.com/icon.png')).toBeNull()
  })

  it('缺少 base64 部分返回 null', async () => {
    const { dataUrlToNativeImage } = await loadIcons()
    expect(dataUrlToNativeImage('data:image/png;base64,')).toBeNull()
  })

  it('合法 data URL 解析为 NativeImage', async () => {
    const { dataUrlToNativeImage } = await loadIcons()
    const img = dataUrlToNativeImage('data:image/png;base64,QUJD')
    expect(img).not.toBeNull()
  })
})

describe('fetchFavicon', () => {
  it('从 URL origin 拼接 /favicon.ico 并返回 data URL', async () => {
    const { fetchFavicon } = await loadIcons()
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFavicon('https://example.com/chat/page')
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/favicon.ico')
    expect(result).toBe('data:image/png;base64,QUJD')
  })

  it('响应非 ok 时返回 null', async () => {
    const { fetchFavicon } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await fetchFavicon('https://example.com')).toBeNull()
  })

  it('fetch 抛错时返回 null（不向上抛出）', async () => {
    const { fetchFavicon } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await fetchFavicon('https://example.com')).toBeNull()
  })

  it('非法 URL 返回 null', async () => {
    const { fetchFavicon } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn())
    expect(await fetchFavicon('not a url')).toBeNull()
    expect(fetchMockNeverCalled()).toBe(true)
  })
})

describe('fetchIconByUrl', () => {
  it('仅允许 http/https 协议', async () => {
    const { fetchIconByUrl } = await loadIcons()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchIconByUrl('ftp://example.com/icon.png')).toBeNull()
    expect(await fetchIconByUrl('file:///etc/passwd')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('合法图标 URL 返回 data URL', async () => {
    const { fetchIconByUrl } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
    expect(await fetchIconByUrl('https://example.com/icon.png')).toBe('data:image/png;base64,QUJD')
  })
})

describe('writeIconToTempFile', () => {
  it('写入临时目录并返回文件路径', async () => {
    const { writeIconToTempFile } = await loadIcons()
    const fakeImage = { toPNG: () => Buffer.from('FAKE_PNG_DATA') }
    const filePath = await writeIconToTempFile(fakeImage as unknown as Electron.NativeImage)

    expect(filePath).not.toBeNull()
    expect(fs.existsSync(filePath!)).toBe(true)
    expect(fs.readFileSync(filePath!)).toEqual(Buffer.from('FAKE_PNG_DATA'))
  })

  it('清理超过 1 分钟的旧图标文件', async () => {
    const { writeIconToTempFile } = await loadIcons()
    const fakeImage = { toPNG: () => Buffer.from('FAKE_PNG_DATA') }

    // 先写入一个旧文件（mtime 回溯 2 分钟）
    const dir = path.join(testDir, 'notify-icons')
    fs.mkdirSync(dir, { recursive: true })
    const staleFile = path.join(dir, 'stale.png')
    fs.writeFileSync(staleFile, 'old')
    const past = new Date(Date.now() - 2 * 60 * 1000)
    fs.utimesSync(staleFile, past, past)

    await writeIconToTempFile(fakeImage as unknown as Electron.NativeImage)
    expect(fs.existsSync(staleFile)).toBe(false)
  })
})

// 辅助：确认 fetch 未被调用（fetchMockNeverCalled 读取最近的 stub）
function fetchMockNeverCalled(): boolean {
  const f = vi.mocked(globalThis.fetch)
  return f === undefined || f.mock.calls.length === 0
}
