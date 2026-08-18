import { EDGE_CLICK_THRESHOLD_PX } from './utils/constants'

const params = new URLSearchParams(window.location.search)
document.documentElement.setAttribute('data-theme', params.get('theme') || 'dark')

window.edgeAPI.onThemeChange((t: string) => {
  document.documentElement.setAttribute('data-theme', t)
})

// 主进程控制：淡出（销毁前）与恢复显示（淡出中途重新进入沉浸模式时取消淡出）。
// 竖条默认可见，淡入不依赖动画，故出现始终可靠。
window.edgeAPI.onShow(() => {
  document.body.classList.remove('fading')
})
window.edgeAPI.onFadeOut(() => {
  document.body.classList.add('fading')
})

let dragging = false
let startX = 0
let startY = 0
let totalDX = 0
let totalDY = 0

function endDrag(): void {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('dragging')
  // 移动 < 阈值视为点击，退出专注模式
  if (Math.abs(totalDX) < EDGE_CLICK_THRESHOLD_PX && Math.abs(totalDY) < EDGE_CLICK_THRESHOLD_PX) {
    window.edgeAPI.exitFocus()
  }
}

// 用 Pointer Events + 指针捕获：拖拽时即使指针短暂滑出仅 20px 宽的边缘窗，
// move 事件仍持续送达，避免快速拖动时 mouseleave 过早结束拖拽导致"断开"。
document.body.addEventListener('pointerdown', e => {
  dragging = true
  startX = e.screenX
  startY = e.screenY
  totalDX = 0
  totalDY = 0
  document.body.classList.add('dragging')
  // 阻止浏览器原生拖拽/选中干扰指针捕获
  e.preventDefault()
  try {
    document.body.setPointerCapture(e.pointerId)
  } catch {
    // 个别平台不支持捕获时退化为普通拖拽
  }
})

document.body.addEventListener('pointermove', e => {
  if (!dragging) return
  const sx = e.screenX
  const sy = e.screenY
  // 捕获态下个别事件可能不带有效屏幕坐标：跳过，避免 NaN 经 IPC 传到主进程崩溃
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
  const dx = Math.round(sx - startX)
  const dy = Math.round(sy - startY)
  totalDX += dx
  totalDY += dy
  startX = sx
  startY = sy
  window.edgeAPI.moveWindow(dx, dy)
})

document.body.addEventListener('pointerup', endDrag)
document.body.addEventListener('pointercancel', endDrag)