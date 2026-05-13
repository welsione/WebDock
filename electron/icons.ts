import { app, nativeImage, NativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'

// ===== App Icon =====
const appIconBaseDir = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '..', '..', 'assets')
export const APP_ICON = `data:image/png;base64,${fs.readFileSync(path.join(appIconBaseDir, 'AppIcon.iconset', 'icon_128x128.png')).toString('base64')}`

// ===== MIME 检测 =====
function detectMimeFromBuffer(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x00 && buf[1] === 0x00) return 'image/x-icon'
  if (buf[0] === 0x3c) return 'image/svg+xml'
  return 'image/png'
}

// ===== ICO 解析 =====
// 从 ICO 容器中提取最大的 PNG 编码图像
function extractPNGFromICO(icoBuf: Buffer): Buffer | null {
  try {
    if (icoBuf.length < 22) return null
    if (icoBuf.readUInt16LE(0) !== 0) return null
    if (icoBuf.readUInt16LE(2) !== 1) return null
    const count = icoBuf.readUInt16LE(4)
    if (count === 0 || count > 20) return null
    let bestSize = 0, bestOffset = 0, bestDataSize = 0
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16
      const w = icoBuf[off] || 256
      const h = icoBuf[off + 1] || 256
      const dataSize = icoBuf.readUInt32LE(off + 8)
      const dataOffset = icoBuf.readUInt32LE(off + 12)
      if (dataOffset + dataSize > icoBuf.length) continue
      if (w * h >= bestSize) { bestSize = w * h; bestOffset = dataOffset; bestDataSize = dataSize }
    }
    if (bestDataSize === 0) return null
    const imgData = icoBuf.subarray(bestOffset, bestOffset + bestDataSize)
    if (imgData[0] === 0x89 && imgData[1] === 0x50 && imgData[2] === 0x4e && imgData[3] === 0x47) {
      return imgData
    }
    return null
  } catch { return null }
}

// ===== 图标下载 =====
function tryFetchIcon(iconUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const { net } = require('electron')
      const request = net.request(iconUrl)
      request.on('response', (response: Electron.IncomingMessage) => {
        if (response.statusCode !== 200) { resolve(null); return }
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (buf.length < 100) { resolve(null); return }
          // ICO 格式：提取内嵌 PNG，因为 nativeImage 不支持 ICO
          const ct = response.headers['content-type']
          let mime = Array.isArray(ct) ? ct[0] : ct
          let data = buf
          if (!mime) mime = detectMimeFromBuffer(buf)
          if (mime === 'image/x-icon' || mime?.includes('icon')) {
            const png = extractPNGFromICO(buf)
            if (png) { mime = 'image/png'; data = png }
          }
          resolve(`data:${mime};base64,${data.toString('base64')}`)
        })
      })
      request.on('error', () => resolve(null))
      setTimeout(() => { try { request.abort() } catch { /* ignore */ } }, 3000)
      request.end()
    } catch (e) { log.error('Failed to fetch icon:', iconUrl, e); resolve(null) }
  })
}

// 从页面 HTML 中解析图标链接
function fetchHtmlIcons(pageUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const { net } = require('electron')
      const req = net.request(pageUrl)
      let data = ''
      req.on('response', (response: Electron.IncomingMessage) => {
        if (response.statusCode !== 200) { resolve([]); return }
        response.on('data', (chunk: Buffer) => { data += chunk.toString() })
        response.on('end', () => {
          const icons: string[] = []
          const origin = new URL(pageUrl).origin
          const re = /<link\s[^>]*\brel=["']?(?:shortcut\s+)?icon["']?[^>]*\bhref=["']([^"']+)["']/gi
          let m: RegExpExecArray | null
          while ((m = re.exec(data)) !== null) {
            let href = m[1]
            if (href.startsWith('//')) href = 'https:' + href
            else if (href.startsWith('/')) href = origin + href
            else if (!href.startsWith('http')) href = origin + '/' + href
            icons.push(href)
          }
          resolve(icons)
        })
      })
      req.on('error', () => resolve([]))
      setTimeout(() => { try { req.abort() } catch { /* ignore */ } }, 5000)
      req.end()
    } catch { resolve([]) }
  })
}

// 获取网站 favicon：先试标准路径，再解析页面 HTML
export async function fetchFavicon(siteUrl: string): Promise<string | null> {
  const origin = new URL(siteUrl).origin
  for (const url of [
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
  ]) {
    const icon = await tryFetchIcon(url)
    if (icon) return icon
  }
  const htmlIcons = await fetchHtmlIcons(siteUrl)
  for (const url of htmlIcons) {
    const icon = await tryFetchIcon(url)
    if (icon) return icon
  }
  return null
}

// ===== 自定义服务商首字母图标 =====
export function generateLetterIcon(name: string): string {
  const letter = (name || '?').charAt(0).toUpperCase()
  const colors = ['#5eead4','#f472b6','#a78bfa','#fb923c','#38bdf8','#4ade80','#facc15','#f87171']
  const color = colors[letter.charCodeAt(0) % colors.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="${color}"/><text x="24" y="32" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" font-family="-apple-system,sans-serif">${letter}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// ===== Data URL → NativeImage 转换 =====
// 封装了 createFromDataURL / createFromBuffer / ICO提取 / SVG回退的完整流程
export function dataUrlToNativeImage(dataUrl: string): NativeImage | null {
  let img = nativeImage.createFromDataURL(dataUrl)
  if (!img.isEmpty()) return img

  // createFromDataURL 失败，尝试 raw buffer（处理 ICO 等格式）
  try {
    const base64 = dataUrl.split(',')[1]
    if (base64) {
      let raw = Buffer.from(base64, 'base64')
      if (dataUrl.includes('image/x-icon') || dataUrl.includes('icon')) {
        const png = extractPNGFromICO(raw)
        if (png) raw = png
      }
      img = nativeImage.createFromBuffer(raw)
      if (!img.isEmpty()) return img
    }
  } catch { /* ignore */ }

  // SVG 图标：提取颜色生成纯色方块
  if (dataUrl.includes('image/svg+xml')) {
    const svgMatch = dataUrl.match(/fill="(#[0-9a-fA-F]{6})"/)
    let hex = svgMatch?.[1] || ''
    if (!hex) {
      try {
        const base64 = dataUrl.split(',')[1]
        if (base64) {
          const raw = Buffer.from(base64, 'base64')
          const sampled = nativeImage.createFromBuffer(raw)
          if (!sampled.isEmpty()) {
            const png = sampled.resize({ width: 1, height: 1 }).toPNG()
            if (png.length > 30) {
              hex = '#' + [png[png.length - 4], png[png.length - 3], png[png.length - 2]]
                .map(v => v.toString(16).padStart(2, '0')).join('')
            }
          }
        }
      } catch { /* ignore */ }
    }
    const r = parseInt(hex.slice(1, 3), 16) || 0x5e
    const g = parseInt(hex.slice(3, 5), 16) || 0xea
    const b = parseInt(hex.slice(5, 7), 16) || 0xd4
    const size = 48
    const buf = Buffer.alloc(size * size * 4)
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = b; buf[i * 4 + 1] = g; buf[i * 4 + 2] = r; buf[i * 4 + 3] = 255
    }
    img = nativeImage.createFromBitmap(buf, { width: size, height: size })
    if (!img.isEmpty()) return img
  }

  return null
}

// 将 NativeImage 写入临时文件（macOS 通知需要本地文件路径）
export function writeIconToTempFile(img: NativeImage): string | null {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'mineai-notify')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `${Date.now()}.png`)
    fs.writeFileSync(tmpFile, img.toPNG())
    // 清理 1 分钟前的旧文件
    try {
      const now = Date.now()
      for (const f of fs.readdirSync(tmpDir)) {
        const fp = path.join(tmpDir, f)
        if (now - fs.statSync(fp).mtimeMs > 60000) fs.unlinkSync(fp)
      }
    } catch { /* ignore cleanup errors */ }
    return tmpFile
  } catch { return null }
}
