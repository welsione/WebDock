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
export async function fetchFavicon(url: string): Promise<string | null> {
  try {
    const parsedUrl = new URL(url)
    const faviconUrl = `${parsedUrl.origin}/favicon.ico`
    const response = await fetch(faviconUrl)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const img = nativeImage.createFromBuffer(buffer)
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

// ===== 从图标 URL 获取图标 =====
export async function fetchIconByUrl(iconUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(iconUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const response = await fetch(iconUrl)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const img = nativeImage.createFromBuffer(buffer)
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}
