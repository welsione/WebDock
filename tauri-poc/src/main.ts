import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const SITES = [
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { name: '豆包', url: 'https://www.doubao.com/chat/' },
  { name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
  { name: 'GitHub', url: 'https://github.com/' },
  { name: '通知测试页', url: 'http://localhost:1420/test-notify.html' }
]

const logEl = document.getElementById('log') as HTMLElement
function log(msg: string, cls = 'info'): void {
  const t = new Date().toTimeString().slice(0, 8)
  logEl.innerHTML += `<div class="${cls}">[${t}] ${msg.replace(/</g, '&lt;')}</div>`
  logEl.scrollTop = logEl.scrollHeight
}

const sitesEl = document.getElementById('sites') as HTMLElement
SITES.forEach(s => {
  const btn = document.createElement('button')
  btn.textContent = s.name
  btn.onclick = async () => {
    const r = await invoke<{ ok: boolean; msg: string }>('navigate_to', { url: s.url })
    log(`切换 → ${s.name} (${s.url}): ${r.msg}`, r.ok ? 'ok' : 'err')
  }
  sitesEl.appendChild(btn)
})

document.getElementById('w74')!.onclick = () => setSidebar(74)
document.getElementById('w240')!.onclick = () => setSidebar(240)
document.getElementById('w320')!.onclick = () => setSidebar(320)

async function setSidebar(w: number): Promise<void> {
  const r = await invoke<{ ok: boolean; msg: string }>('set_sidebar_width', { width: w })
  log(`布局 → 侧边栏 ${w}px: ${r.msg}`, r.ok ? 'ok' : 'err')
}

// 诊断：前端错误可视化（页面顶部红色条）
window.addEventListener('error', e => {
  const bar = document.getElementById('errbar')
  if (bar) { bar.style.display = 'block'; bar.textContent += `[error] ${e.message}\n` }
})
window.addEventListener('unhandledrejection', e => {
  const bar = document.getElementById('errbar')
  if (bar) { bar.style.display = 'block'; bar.textContent += `[rejection] ${String(e.reason)}\n` }
})

// 监听 Rust 转发的通知事件
listen('notify-received', e => {
  const d = e.payload as { title: string; body: string; key: string }
  log(`[通知] ${d.key}: ${d.title} — ${d.body}`, 'ok')
  invoke('report_event_received', { event: 'notify-received', payload: JSON.stringify(d) })
}).catch(err => {
  const bar = document.getElementById('errbar')
  if (bar) { bar.style.display = 'block'; bar.textContent += `[listen notify 失败] ${String(err)}\n` }
})

// 诊断：确认 Rust → ui 事件通道（与 notify 同一 emit_to 机制）
listen('poc-test', e => {
  const d = e.payload as { type: string; url?: string }
  log(`[事件通道诊断] ${d.type}${d.url ? ': ' + d.url : ''}`, 'ok')
  invoke('report_event_received', { event: 'poc-test', payload: JSON.stringify(d) })
}).catch(err => {
  const bar = document.getElementById('errbar')
  if (bar) { bar.style.display = 'block'; bar.textContent += `[listen poc-test 失败] ${String(err)}\n` }
})

log('控制台就绪，等待操作…')
