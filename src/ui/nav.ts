import { toast } from './toast'
import { showLoading, hideLoading } from './loading'
import { getState, setCurrentProvider, updateProviders, type ProviderStatusMap } from '../state'

let nav: HTMLElement

export function initNav(navId: string): void {
  nav = document.getElementById(navId) as HTMLElement
}

export function renderNav(providerStatus: ProviderStatusMap): void {
  const { providers, currentProviderKey } = getState()
  nav.innerHTML = ''
  providers.forEach((x, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'nav-item'
    btn.dataset.active = String(x.key === currentProviderKey)
    btn.title = `${x.name} (${i + 1})`
    btn.addEventListener('click', () => setActive(x.key))
    const img = document.createElement('img')
    img.src = x.icon || ''
    img.alt = x.name
    img.style.width = '24px'
    img.style.height = '24px'
    img.style.borderRadius = '6px'
    btn.appendChild(img)
    // 加载状态指示器
    const status = providerStatus.get(x.key)
    if (status) {
      const dot = document.createElement('div')
      dot.className = `nav-status ${status}`
      btn.appendChild(dot)
    }
    nav.appendChild(btn)
  })
}

function setActive(key: string): void {
  // 关闭设置页
  const settingsPage = document.getElementById('settingsPage')
  if (settingsPage?.classList.contains('visible')) {
    settingsPage.classList.remove('visible')
    window.electronAPI.toggleSettings(false)
  }
  setCurrentProvider(key)
  window.electronAPI.switchProvider(key)
}

export function setupLoadingListener(): void {
  window.electronAPI.onLoading(data => {
    const { provider, status, error } = data
    const { providers, providerStatus } = getState()
    if (status === 'loading') {
      providerStatus.set(provider, 'loading')
      const p = providers.find(x => x.key === provider)
      showLoading(p ? `正在加载 ${p.name}…` : '正在加载…')
    } else if (status === 'loaded') {
      providerStatus.delete(provider)
      hideLoading()
    } else if (status === 'error') {
      providerStatus.set(provider, 'error')
      hideLoading()
      toast(`加载失败：${error || '未知错误'}`)
    }
    renderNav(providerStatus)
  })
}

export function setupProviderUpdateListener(): void {
  window.electronAPI.onProvidersUpdated(updatedProviders => {
    updateProviders(updatedProviders)
    renderNav(getState().providerStatus)
    // 同步刷新设置页服务商列表
    const settingsPage = document.getElementById('settingsPage')
    if (settingsPage?.classList.contains('visible')) {
      // Defer to settings module
      document.dispatchEvent(new CustomEvent('settings-refresh-providers'))
    }
    // 如果当前选中的服务商被移除，切换到第一个
    const { currentProviderKey } = getState()
    if (!updatedProviders.find(p => p.key === currentProviderKey) && updatedProviders.length > 0) {
      setActive(updatedProviders[0].key)
    }
  })
}
