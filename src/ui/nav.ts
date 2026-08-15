import { getState, setCurrentWebApp, setAppStatus, updateWebApps } from '../state'

let navContainer: HTMLElement | null = null

export function initNav(el: HTMLElement): void {
  navContainer = el
}

export function renderNav(): void {
  if (!navContainer) return
  navContainer.innerHTML = ''
  const { webApps, currentWebAppKey, appStatus } = getState()

  webApps.forEach(p => {
    const item = document.createElement('div')
    item.className = `nav-item${p.key === currentWebAppKey ? ' active' : ''}`
    item.dataset.key = p.key

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
    const sidebarColor = p.color ? (isDark ? p.color.dark : p.color.light) : ''

    const iconEl = document.createElement('img')
    iconEl.src = p.icon || ''
    iconEl.alt = p.name
    iconEl.className = 'nav-item-icon'
    iconEl.onerror = () => { iconEl.style.display = 'none' }

    if (sidebarColor) item.style.setProperty('--nav-bg', sidebarColor)

    // 状态点
    const status = appStatus.get(p.key)
    if (status) {
      const dot = document.createElement('span')
      dot.className = `nav-status-dot ${status}`
      item.appendChild(dot)
    }

    item.appendChild(iconEl)
    item.addEventListener('click', () => {
      setCurrentWebApp(p.key)
      window.electronAPI.switchWebApp(p.key)
      renderNav()
    })
    navContainer!.appendChild(item)
  })
}

export function setupLoadingListener(): void {
  window.electronAPI.onLoading(data => {
    const { app, status } = data as { app: string; status: 'loading' | 'loaded' | 'error' | 'starting' }
    setAppStatus(app, status)
    renderNav()
  })
}

export function setupWebAppUpdateListener(): void {
  window.electronAPI.onWebAppsUpdated(webApps => {
    updateWebApps(webApps)
    renderNav()
  })
}
