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
  function imageResponse(contentType = 'image/x-icon'): { ok: boolean; headers: { get: (n: string) => string }; arrayBuffer: () => Promise<ArrayBuffer> } {
    return { ok: true, headers: { get: (n: string) => (n === 'content-type' ? contentType : '') }, arrayBuffer: async () => new ArrayBuffer(8) }
  }

  it('从 URL origin 拼接 /favicon.ico 并返回 data URL', async () => {
    const { fetchFavicon } = await loadIcons()
    const fetchMock = vi.fn(async () => imageResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFavicon('https://example.com/chat/page')
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/favicon.ico')
    expect(result).toBe('data:image/png;base64,QUJD')
  })

  it('favicon 响应是 HTML 时返回 null（不把网页当图标）', async () => {
    const { fetchFavicon } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse('text/html; charset=utf-8')))
    expect(await fetchFavicon('https://example.com')).toBeNull()
  })

  it('SVG favicon 返回 data:image/svg+xml（不走 nativeImage——createFromBuffer 不支持 SVG）', async () => {
    const { fetchFavicon } = await loadIcons()
    createFromBufferMock.mockClear() // 同一 mock 跨测试共享，先清计数
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? 'image/svg+xml' : '') },
      arrayBuffer: async () => new TextEncoder().encode(svgContent).buffer
    })))
    const result = await fetchFavicon('https://example.com')
    expect(result).toBe(`data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`)
    // 确认没有调用 createFromBuffer（SVG 走了 data URL 直返路径）
    expect(createFromBufferMock).not.toHaveBeenCalled()
  })

  it('.ico 非图片时自动回退尝试 /favicon.svg（本地服务仅提供 svg 图标的场景）', async () => {
    const { fetchFavicon } = await loadIcons()
    createFromBufferMock.mockClear()
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>'
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? (url.endsWith('.svg') ? 'image/svg+xml' : 'text/html') : '') },
      arrayBuffer: async () => new TextEncoder().encode(svgContent).buffer
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFavicon('http://127.0.0.1:3080')
    expect(result).toBe(`data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`)
    // 先试 favicon.ico（HTML 被拒）→ 再试 favicon.svg
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'http://127.0.0.1:3080/favicon.ico',
      'http://127.0.0.1:3080/favicon.svg'
    ])
  })

  it('响应非 ok 时返回 null', async () => {
    const { fetchFavicon } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, headers: { get: () => '' } })))
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

  it('URL 本身是图片时直接返回 data URL', async () => {
    const { fetchIconByUrl } = await loadIcons()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? 'image/png' : '') },
      arrayBuffer: async () => new ArrayBuffer(8)
    })))
    expect(await fetchIconByUrl('https://example.com/icon.png')).toBe('data:image/png;base64,QUJD')
  })

  it('URL 返回 HTML 时自动回退请求站点 /favicon.ico', async () => {
    const { fetchIconByUrl } = await loadIcons()
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? (url.includes('/favicon.ico') ? 'image/x-icon' : 'text/html') : '') },
      arrayBuffer: async () => new ArrayBuffer(8)
    }))
    vi.stubGlobal('fetch', fetchMock)

    // 用户填服务商主页（HTML），应自动去拉 favicon
    expect(await fetchIconByUrl('https://example.com')).toBe('data:image/png;base64,QUJD')
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://example.com',
      'https://example.com/favicon.ico'
    ])
  })

  it('URL 与 favicon 都非图片时返回 null（如本地服务首页无图标）', async () => {
    const { fetchIconByUrl } = await loadIcons()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? 'text/html; charset=utf-8' : '') },
      arrayBuffer: async () => new ArrayBuffer(8)
    }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchIconByUrl('http://127.0.0.1:3080')).toBeNull()
    // 3 次尝试：URL 本身 + /favicon.ico + /favicon.svg
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('URL 请求抛错时回退 favicon；favicon 也失败返回 null', async () => {
    const { fetchIconByUrl } = await loadIcons()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/favicon.ico')) throw new Error('network down')
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchIconByUrl('https://example.com')).toBeNull()
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

