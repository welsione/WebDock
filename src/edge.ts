const params = new URLSearchParams(window.location.search)
document.documentElement.setAttribute('data-theme', params.get('theme') || 'dark')

window.edgeAPI.onThemeChange((t) => {
  document.documentElement.setAttribute('data-theme', t)
})

let dragging = false
let startX = 0
let startY = 0
let totalDX = 0
let totalDY = 0

document.body.addEventListener('mousedown', (e) => {
  dragging = true
  startX = e.screenX
  startY = e.screenY
  totalDX = 0
  totalDY = 0
  document.body.classList.add('dragging')
  e.preventDefault()
})

window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const dx = e.screenX - startX
  const dy = e.screenY - startY
  totalDX += dx
  totalDY += dy
  startX = e.screenX
  startY = e.screenY
  window.edgeAPI.moveWindow(dx, dy)
})

window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('dragging')
  // 移动 < 3px 视为点击，退出专注模式
  if (Math.abs(totalDX) < 3 && Math.abs(totalDY) < 3) {
    window.edgeAPI.exitFocus()
  }
})
