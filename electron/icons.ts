// ===== 图标工具模块 =====
// 负责应用图标、服务商图标获取、通知图标写入

import { app, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import log from 'electron-log'
import { NOTIFY_ICON_CLEANUP_MS } from './config'

// ===== 从 data URL 解析 NativeImage =====
export function dataUrlToNativeImage(dataUrl: string): Electron.NativeImage | null {
  try {
    if (!dataUrl.startsWith('data:')) return null
    const base64 = dataUrl.split(',')[1]
    if (!base64) return null
    return nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

// ===== 从 URL 获取图标 =====
export function generateLetterIcon(name: string): string {
  const letter = (name || '?')[0].toUpperCase()
  const size = 48
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" rx="8" fill="#4a9eff"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        fill="white" font-size="24" font-family="system-ui, sans-serif" font-weight="600">${letter}</text>
    </svg>`
  // 直接返回 SVG data URL（<img> 可直接渲染）。
  // 注意：不能用 nativeImage.createFromBuffer 处理 SVG buffer——Electron 仅支持 PNG/JPEG，
  // 对 SVG 会得到空图像，toDataURL() 返回无效的空 data URL
  return `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`
}

// ===== 异步写入临时图标文件 =====
export async function writeIconToTempFile(image: Electron.NativeImage): Promise<string | null> {
  try {
    const tmpDir = path.join(app.getPath('userData'), 'notify-icons')
    await fs.promises.mkdir(tmpDir, { recursive: true })

    // 清理超过 1 小时的旧图标
    const now = Date.now()
    try {
      const files = await fs.promises.readdir(tmpDir)
      for (const file of files) {
        try {
          const filePath = path.join(tmpDir, file)
          const stat = await fs.promises.stat(filePath)
          if (now - stat.mtimeMs > NOTIFY_ICON_CLEANUP_MS) {
            await fs.promises.unlink(filePath)
          }
        } catch { /* ignore individual file errors */ }
      }
    } catch { /* ignore cleanup errors */ }

    const tmpFile = path.join(tmpDir, `${crypto.randomUUID()}.png`)
    await fs.promises.writeFile(tmpFile, image.toPNG())
    return tmpFile
  } catch (e) {
    log.error('Failed to write icon to temp file:', e)
    return null
  }
}

// ===== 从 URL 获取 favicon =====
// 只接受 image/* 响应：HTML/JSON 页面（如 SPA 或本地服务首页）不能当图标解析
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url)
  if (!response.ok) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) return null
  const buffer = Buffer.from(await response.arrayBuffer())
  // SVG 无法经 nativeImage 解析（createFromBuffer 仅支持 PNG/JPEG），直接返回 SVG data URL
  //（<img> 可渲染；与 generateLetterIcon 同源的坑）
  if (contentType.includes('svg') || buffer.toString('utf8', 0, 512).includes('<svg')) {
    return `data:image/svg+xml;base64,${buffer.toString('base64')}`
  }
  const img = nativeImage.createFromBuffer(buffer)
  return img.isEmpty() ? null : img.toDataURL()
}

// 从站点自动找 favicon：依次尝试约定路径（/favicon.ico → /favicon.svg），
// 单个候选失败（404/HTML/网络错误）不阻断后续候选
export async function fetchFavicon(url: string): Promise<string | null> {
  try {
    const parsedUrl = new URL(url)
    const origin = parsedUrl.origin
    const candidates = [`${origin}/favicon.ico`, `${origin}/favicon.svg`]
    for (const candidate of candidates) {
      try {
        const icon = await fetchImageAsDataUrl(candidate)
        if (icon) return icon
      } catch { /* 继续下一个候选 */ }
    }
    return null
  } catch {
    return null
  }
}

// ===== 从图标 URL 获取图标 =====
// 1) 直接尝试用户填的 URL（若是图片则直接成功）
// 2) 回退：从该站点自动找 /favicon.ico（用户常填服务商主页而非图标地址）
export async function fetchIconByUrl(iconUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(iconUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
  } catch {
    return null
  }
  try {
    const direct = await fetchImageAsDataUrl(iconUrl)
    if (direct) return direct
  } catch { /* 网络失败继续回退 favicon */ }
  return await fetchFavicon(iconUrl)
}
