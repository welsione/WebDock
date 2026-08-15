import { TOAST_DURATION_MS } from '../utils/constants'

let container: HTMLElement | null = null

export function initToast(el: HTMLElement): void {
  container = el
}

export function toast(msg: string): void {
  if (!container) return
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  container.appendChild(el)
  const remove = () => {
    if (!el.parentNode) return
    el.classList.add('out')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }
  const t = setTimeout(remove, TOAST_DURATION_MS)
  el.addEventListener('click', () => {
    clearTimeout(t)
    remove()
  })
}
