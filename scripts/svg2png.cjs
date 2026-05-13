/**
 * SVG → PNG 转换工具
 * 使用 Electron 的 BrowserWindow 渲染 SVG，捕获后输出 PNG
 * 用法: npx electron --user-data-dir=/tmp/elec-svg2png scripts/svg2png.cjs assets/zhipu.svg assets/zhipu.png
 * 或: ./node_modules/.bin/electron --user-data-dir=/tmp/elec-svg2png scripts/svg2png.cjs <in> <out>
 */

const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const argv = process.argv.filter(a => !a.startsWith('--'))

const svgPath = argv[2]
const pngPath = argv[3]

if (!svgPath || !pngPath) {
  console.error('用法: electron --user-data-dir=/tmp/elec-svg2png scripts/svg2png.cjs <svg> <png>')
  process.exit(1)
}

const absSvg = path.resolve(svgPath)
const absPng = path.resolve(pngPath)

if (!fs.existsSync(absSvg)) {
  console.error('SVG 文件不存在:', absSvg)
  process.exit(1)
}

app.whenReady().then(() => {
  const svgData = fs.readFileSync(absSvg, 'utf-8')
  const svgDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svgData).toString('base64')

  const html = '<!DOCTYPE html>\n' +
    '<html>\n' +
    '<body style="margin:0;width:256px;height:256px;display:flex;align-items:center;justify-content:center;background:transparent">\n' +
    '  <img src="' + svgDataUrl + '" style="width:128px;height:128px">\n' +
    '</body>\n' +
    '</html>'

  const bw = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    transparent: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  bw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
    setTimeout(async () => {
      try {
        const img = await bw.webContents.capturePage()
        fs.writeFileSync(absPng, img.toPNG())
        console.log('✅ 已转换:', absSvg, '→', absPng)
      } catch (e) {
        console.error('转换失败:', e.message)
      }
      bw.destroy()
      app.quit()
    }, 1000)
  }).catch(e => {
    console.error('加载失败:', e.message)
    bw.destroy()
    app.quit()
  })
})
