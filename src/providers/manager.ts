import { getState, removeWebApp, updateWebAppSettings } from '../state'
import { escapeHtml } from '../utils/escape-html'
import { byIdOrNull } from '../utils/dom'
import { openWebAppModal } from '../ui/provider-modal'
import { toast } from '../ui/toast'

let dragSrcEl: HTMLElement | null = null

/** 查询并刷新某行的服务运行状态 */
function refreshServiceState(row: HTMLElement, key: string): void {
  const dot = row.querySelector<HTMLElement>('.webapp-service-dot')
  const btn = row.querySelector<HTMLButtonElement>('.webapp-service-btn')
  if (!dot || !btn) return
  dot.classList.add('unknown')
  btn.disabled = true
  window.electronAPI.getServiceStatus(key).then(({ running }) => {
    dot.classList.remove('unknown')
    dot.classList.toggle('running', running)
    dot.classList.toggle('stopped', !running)
    btn.textContent = running ? '停止' : '启动'
    btn.disabled = false
  }).catch(() => {
    dot.classList.remove('unknown')
    btn.disabled = false
  })
}

export function renderWebAppList(): void {
  const list = byIdOrNull<HTMLDivElement>('webAppList')
  if (!list) return
  list.innerHTML = ''
  const { webAppSettings } = getState()
  const webApps = webAppSettings.webApps

  webApps.forEach(app => {
    const el = document.createElement('div')
    el.className = 'webapp-item'
    el.draggable = true
    el.dataset.key = app.key

    const iconHtml = app.icon
      ? `<img src="${escapeHtml(app.icon)}" alt="${escapeHtml(app.name)}">`
      : `<div class="provider-letter-icon">${escapeHtml((app.name || '?')[0].toUpperCase())}</div>`

    const serviceHtml = app.launch
      ? `<span class="webapp-service-dot stopped" title="服务状态"></span>
         <button class="btn-sm btn-ghost webapp-service-btn" title="启动/停止本地服务">启动</button>`
      : ''

    const editHtml = `<button class="provider-edit" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>`

    const deleteHtml = `<button class="provider-delete" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`

    el.innerHTML = `
      <div class="drag-handle" title="拖拽排序">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/></svg>
      </div>
      ${iconHtml}
      <div class="provider-item-info" data-key="${escapeHtml(app.key)}">
        <div class="provider-item-name">${escapeHtml(app.name)}</div>
        <div class="provider-item-url">${escapeHtml(app.url)}</div>
      </div>
      ${serviceHtml}
      ${editHtml}
      ${deleteHtml}
    `

    const editBtn = el.querySelector('.provider-edit') as HTMLElement
    editBtn.addEventListener('click', e => {
      e.stopPropagation()
      openWebAppModal({
        key: app.key,
        name: app.name,
        url: app.url,
        icon: app.icon ?? null,
        color: app.color,
        notify: app.notify,
        permissions: app.permissions,
        trustCertificate: app.trustCertificate,
        launch: app.launch
      })
    })

    const deleteBtn = el.querySelector('.provider-delete') as HTMLElement
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation()
      el.remove()
      removeWebApp(app.key) // 按 key 删除——渲染快照 index 在拖拽后会漂移
      saveWebAppOrderFromDOM()
    })

    // 服务启动/停止
    const serviceBtn = el.querySelector<HTMLButtonElement>('.webapp-service-btn')
    if (serviceBtn) {
      serviceBtn.addEventListener('click', e => {
        e.stopPropagation()
        const isRunning = el.querySelector('.webapp-service-dot')?.classList.contains('running')
        if (isRunning) {
          window.electronAPI.stopService(app.key).then(r => {
            if (r.ok) toast('服务已停止')
            else toast(r.error || '停止失败')
            refreshServiceState(el, app.key)
          })
        } else {
          window.electronAPI.ensureServiceUp(app.key).then(r => {
            if (r.ok) toast(r.launched ? '服务已启动' : '服务已在运行')
            else toast(r.error || '启动失败')
            refreshServiceState(el, app.key)
          })
        }
      })
      // 初始状态查询
      refreshServiceState(el, app.key)
    }

    // 拖拽事件
    el.addEventListener('dragstart', e => {
      dragSrcEl = el
      el.classList.add('dragging')
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData('text/plain', app.key)
    })
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging')
      list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'))
      dragSrcEl = null
    })
    el.addEventListener('dragover', e => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (el !== dragSrcEl) el.classList.add('drag-over')
    })
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
    el.addEventListener('drop', e => {
      e.preventDefault()
      el.classList.remove('drag-over')
      if (!dragSrcEl || el === dragSrcEl) return
      const items = [...list.children] as HTMLElement[]
      const fromIdx = items.indexOf(dragSrcEl)
      const toIdx = items.indexOf(el)
      if (fromIdx < toIdx) list.insertBefore(dragSrcEl, el.nextSibling)
      else list.insertBefore(dragSrcEl, el)
      saveWebAppOrderFromDOM()
    })

    list.appendChild(el)
  })
}

export function saveWebAppOrderFromDOM(): void {
  const list = byIdOrNull<HTMLDivElement>('webAppList')
  if (!list) return
  const order = [...list.children].map(el => (el as HTMLElement).dataset.key!)
  const { webAppSettings } = getState()
  const orderMap = new Map(order.map((k, i) => [k, i]))
  const reordered = [...webAppSettings.webApps].sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  updateWebAppSettings({ ...webAppSettings, webApps: reordered })
  window.electronAPI.saveWebAppOrder(order)
  window.electronAPI.saveWebAppSettings({ webApps: reordered, appSettings: webAppSettings.appSettings })
}
