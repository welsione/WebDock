import { getState, setCurrentProvider } from '../state'
import { byIdOrNull } from '../utils/dom'

let navContainer: HTMLElement | null = null

export function initNav(el: HTMLElement): void {
  navContainer = el
}

export function renderNav(providerStatus: Map<string, 'loading' | 'error'>): void {
  if (!navContainer) return
  navContainer.innerHTML = ''
  const { providers } = getState()
  const currentKey = getState().currentProviderKey

  providers.forEach(p => {
    const item = document.createElement('div')
    item.className = `nav-item${p.key === currentKey ? ' active' : ''}`
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
    const status = providerStatus.get(p.key)
    if (status) {
      const dot = document.createElement('span')
      dot.className = `nav-status-dot ${status}`
      item.appendChild(dot)
    }

    item.appendChild(iconEl)
    item.addEventListener('click', () => {
      setCurrentProvider(p.key)
      window.electronAPI.switchProvider(p.key)
      renderNav(providerStatus)
    })
    navContainer!.appendChild(item)
  })
}

export function setupLoadingListener(): void {
  window.electronAPI.onLoading(data => {
    const { provider, status } = data as { provider: string; status: 'loading' | 'loaded' | 'error' }
    const providerStatus = getState().providerStatus
    if (status === 'loading') {
      providerStatus.set(provider, 'loading')
    } else if (status === 'error') {
      providerStatus.set(provider, 'error')
    } else {
      providerStatus.delete(provider)
    }
    renderNav(providerStatus)
  })
}

export function setupProviderUpdateListener(): void {
  window.electronAPI.onProvidersUpdated(providers => {
    const { updateProviders } = require('../state') as typeof import('../state')
    updateProviders(providers as ProviderInfo[])
    renderNav(getState().providerStatus)
  })
}
