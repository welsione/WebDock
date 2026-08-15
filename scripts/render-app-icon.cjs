/**
 * 应用图标批量渲染脚本（WebDock）
 *
 * 读取 assets/icon-master.svg（唯一设计源），用 Electron/Chromium 以矢量方式
 * 逐尺寸渲染（2x 超采样后精确缩放到目标尺寸），输出：
 *   - assets/AppIcon.iconset/ 全部 10 张标准 macOS 图标
 *   - assets/app-icon.png     应用内图标（128×128）
 *   - assets/icon.icns        打包用 icns（iconutil 编译）
 *
 * 用法: npm run icons
 *   或: ./node_modules/.bin/electron --no-sandbox --disable-gpu \
 *        --user-data-dir=/tmp/webdock-icon-render scripts/render-app-icon.cjs
 */

const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SVG_PATH = path.join(ROOT, 'assets', 'icon-master.svg')
const ICONSET_DIR = path.join(ROOT, 'assets', 'AppIcon.iconset')
const ICNS_PATH = path.join(ROOT, 'assets', 'icon.icns')
const APP_ICON_PATH = path.join(ROOT, 'assets', 'app-icon.png')

// [文件名, 目标像素]
const TARGETS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function svgDataUrl() {
  const data = fs.readFileSync(SVG_PATH, 'utf-8')
  return 'data:image/svg+xml;base64,' + Buffer.from(data).toString('base64')
}

async function renderAt(bw, px) {
  // 2x 超采样，最小 64 保证采样质量
  const size = Math.max(px * 2, 64)
  bw.setContentSize(size, size)
  await sleep(120)
  const html =
    '<!DOCTYPE html><html><body style="margin:0;width:100%;height:100%;background:transparent">' +
    '<img src="' + svgDataUrl() + '" style="width:100%;height:100%;display:block">' +
    '</body></html>'
  await bw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await sleep(250) // 等 SVG 完成栅格化
  const img = await bw.webContents.capturePage()
  return img.resize({ width: px, height: px, quality: 'best' })
}

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(ICONSET_DIR)) fs.mkdirSync(ICONSET_DIR, { recursive: true })
    for (const f of fs.readdirSync(ICONSET_DIR)) {
      if (/^icon_.*\.png$/.test(f)) fs.unlinkSync(path.join(ICONSET_DIR, f))
    }

    const bw = new BrowserWindow({
      width: 64,
      height: 64,
      useContentSize: true,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    for (const [name, px] of TARGETS) {
      let img = null
      for (let attempt = 1; attempt <= 3 && !img; attempt++) {
        try {
          img = await renderAt(bw, px)
        } catch (e) {
          console.warn(`⚠️ ${name} 第 ${attempt} 次渲染失败:`, e.message)
          await sleep(400)
        }
      }
      if (!img) throw new Error(`${name} 渲染失败（已重试 3 次）`)
      fs.writeFileSync(path.join(ICONSET_DIR, name), img.toPNG())
      console.log('✅', name, `${px}×${px}`)
    }

    // 应用内图标 128×128
    const appIcon = await renderAt(bw, 128)
    fs.writeFileSync(APP_ICON_PATH, appIcon.toPNG())
    console.log('✅ app-icon.png 128×128')
    bw.destroy()

    // 编译 icns
    execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', ICNS_PATH])
    console.log('✅ icon.icns 已生成:', ICNS_PATH)
    process.exit(0)
  } catch (e) {
    console.error('❌ 渲染失败:', e)
    process.exit(1)
  }
})
