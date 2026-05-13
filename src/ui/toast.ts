let container: HTMLElement

export function initToast(containerId: string): void {
  container = document.getElementById(containerId) as HTMLElement
}

export function toast(msg: string): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  container.appendChild(el)
  const remove = () => {
    if (!el.parentNode) return
    el.classList.add('out')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }
  const t = setTimeout(remove, 1600)
  el.addEventListener('click', () => {
    clearTimeout(t)
    remove()
  })
}
