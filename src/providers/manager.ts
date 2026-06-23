import { getState, removeCustomProvider, setEnabledProviders } from '../state'
import { escapeHtml } from '../utils/escape-html'
import { byIdOrNull } from '../utils/dom'

let dragSrcEl: HTMLElement | null = null

export function renderProviderList(): void {
  const list = byIdOrNull<HTMLDivElement>('providerList')
  if (!list) return
  list.innerHTML = ''
  const { builtIn, enabled, custom } = getState().providerSettings

  interface ProviderItem {
    type: 'builtin' | 'custom'
    key: string
    name: string
    url: string
    icon: string | null
    color: { dark: string; light: string }
    checked: boolean
    index?: number
  }

  const allItems: ProviderItem[] = []
  builtIn.forEach((p: { key: string; name: string; url: string; icon: string; color: { dark: string; light: string } }) => {
    const isChecked = enabled === null || enabled.includes(p.key)
    allItems.push({
      type: 'builtin', key: p.key, name: p.name, url: p.url,
      icon: p.icon, color: p.color || { dark: '#151517', light: '#ffffff' }, checked: isChecked
    })
  })
  custom.forEach((p: { key: string; name: string; url: string; icon: string | null; color?: { dark: string; light: string } }, i: number) => {
    allItems.push({
      type: 'custom', key: p.key, name: p.name, url: p.url,
      icon: p.icon || null, color: p.color || { dark: '#1a1e28', light: '#f0f2f5' },
      index: i, checked: true
    })
  })

  if (getState().providerSettings.order) {
    const orderMap = new Map(getState().providerSettings.order!.map((k: string, i: number) => [k, i] as [string, number]))
    allItems.sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  }

  allItems.forEach(item => {
    const el = document.createElement('div')
    el.className = 'provider-item'
    el.draggable = true
    el.dataset.key = item.key

    const iconHtml = item.icon
      ? `<img src="${escapeHtml(item.icon)}" alt="${escapeHtml(item.name)}">`
      : `<div class="provider-letter-icon">${escapeHtml((item.name || '?')[0].toUpperCase())}</div>`

    const deleteHtml = item.type === 'custom'
      ? `<button class="provider-delete" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
      : ''

    el.innerHTML = `
      <div class="drag-handle" title="拖拽排序">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/></svg>
      </div>
      <input type="checkbox" class="provider-checkbox" ${item.checked ? 'checked' : ''}>
      ${iconHtml}
      <div class="provider-item-info" data-key="${escapeHtml(item.key)}" data-type="${item.type}" data-index="${item.index ?? ''}">
        <div class="provider-item-name">${escapeHtml(item.name)}</div>
        <div class="provider-item-url">${escapeHtml(item.url)}</div>
      </div>
      ${deleteHtml}
    `

    const checkbox = el.querySelector('.provider-checkbox') as HTMLInputElement
    checkbox.addEventListener('change', () => {
      if (item.type === 'builtin') {
        toggleBuiltInProvider(item.key, checkbox.checked)
      }
    })

    if (item.type === 'custom') {
      const deleteBtn = el.querySelector('.provider-delete') as HTMLElement
      deleteBtn.addEventListener('click', () => {
        el.remove()
        if (item.index !== undefined) removeCustomProvider(item.index)
        saveProviderOrderFromDOM()
      })
    }

    // 拖拽事件
    el.addEventListener('dragstart', e => {
      dragSrcEl = el
      el.classList.add('dragging')
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData('text/plain', item.key)
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
      saveProviderOrderFromDOM()
    })

    list.appendChild(el)
  })
}

export function saveProviderOrderFromDOM(): void {
  const list = byIdOrNull<HTMLDivElement>('providerList')
  if (!list) return
  const order = [...list.children].map(el => (el as HTMLElement).dataset.key!)
  const checked = [...list.querySelectorAll<HTMLInputElement>('.provider-checkbox:checked')].map(
    cb => (cb.closest('.provider-item') as HTMLElement).dataset.key!
  )
  const { providerSettings } = getState()
  const enabledBuiltIn = providerSettings.builtIn.map((p: { key: string }) => p.key).filter((k: string) => checked.includes(k))
  window.electronAPI.saveProviderOrder(order)
  setEnabledProviders(enabledBuiltIn)
  window.electronAPI.saveProviderSettings({ enabled: enabledBuiltIn, custom: providerSettings.custom })
}

function toggleBuiltInProvider(key: string, enabled: boolean): void {
  const { providerSettings } = getState()
  let current = providerSettings.enabled
  if (current === null) current = providerSettings.builtIn.map(p => p.key)
  if (enabled) {
    if (!current.includes(key)) current.push(key)
  } else {
    current = current.filter(k => k !== key)
  }
  setEnabledProviders(current)
  saveProviderOrderFromDOM()
}
