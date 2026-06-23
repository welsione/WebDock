import { getState, addCustomProvider, updateCustomProvider } from '../state'
import { escapeHtml } from '../utils/escape-html'
import { byIdOrNull, byId } from '../utils/dom'

let editingIndex: number | null = null

export function showAddProviderModal(index: number | null = null): void {
  editingIndex = index

  const overlay = byIdOrNull<HTMLDivElement>('addProviderOverlay')
  if (!overlay) return

  const nameInput = byIdOrNull<HTMLInputElement>('providerName')
  const urlInput = byIdOrNull<HTMLInputElement>('providerUrl')
  const iconInput = byIdOrNull<HTMLInputElement>('providerIcon')
  const darkColorInput = byIdOrNull<HTMLInputElement>('providerDarkColor')
  const lightColorInput = byIdOrNull<HTMLInputElement>('providerLightColor')
  const titleEl = byIdOrNull<HTMLElement>('modalTitle')

  if (editingIndex !== null) {
    const custom = getState().providerSettings.custom[editingIndex]
    if (titleEl) titleEl.textContent = '编辑服务商'
    if (nameInput) nameInput.value = custom.name
    if (urlInput) urlInput.value = custom.url
    if (iconInput) iconInput.value = custom.icon || ''
    if (darkColorInput) darkColorInput.value = custom.color?.dark || '#1a1e28'
    if (lightColorInput) lightColorInput.value = custom.color?.light || '#f0f2f5'
  } else {
    if (titleEl) titleEl.textContent = '添加服务商'
    if (nameInput) nameInput.value = ''
    if (urlInput) urlInput.value = ''
    if (iconInput) iconInput.value = ''
    if (darkColorInput) darkColorInput.value = '#1a1e28'
    if (lightColorInput) lightColorInput.value = '#f0f2f5'
  }

  overlay.classList.add('visible')
  if (nameInput) nameInput.focus()
}

export function hideAddProviderModal(): void {
  const overlay = byIdOrNull<HTMLDivElement>('addProviderOverlay')
  if (overlay) overlay.classList.remove('visible')
  editingIndex = null
}

function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: '仅支持 http/https 协议' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: '无效的 URL 格式' }
  }
}

export function setupProviderModal(): void {
  const addBtn = byIdOrNull<HTMLButtonElement>('addProviderBtn')
  const cancelBtn = byIdOrNull<HTMLButtonElement>('cancelProviderBtn')
  const saveBtn = byIdOrNull<HTMLButtonElement>('saveProviderBtn')
  const overlay = byIdOrNull<HTMLDivElement>('addProviderOverlay')
  const iconInput = byIdOrNull<HTMLInputElement>('providerIcon')
  const fetchIconBtn = byIdOrNull<HTMLButtonElement>('fetchIconBtn')

  addBtn?.addEventListener('click', () => showAddProviderModal())
  cancelBtn?.addEventListener('click', hideAddProviderModal)

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) hideAddProviderModal()
  })

  saveBtn?.addEventListener('click', async () => {
    const nameInput = byId<HTMLInputElement>('providerName')
    const urlInput = byId<HTMLInputElement>('providerUrl')
    const iconInputEl = byId<HTMLInputElement>('providerIcon')
    const darkColorInput = byId<HTMLInputElement>('providerDarkColor')
    const lightColorInput = byId<HTMLInputElement>('providerLightColor')

    const name = nameInput.value.trim()
    const url = urlInput.value.trim()
    const icon = iconInputEl.value.trim() || null
    const darkColor = darkColorInput.value || '#1a1e28'
    const lightColor = lightColorInput.value || '#f0f2f5'

    if (!name || !url) return

    const urlValidation = validateUrl(url)
    if (!urlValidation.valid) {
      nameInput.setCustomValidity('')
      urlInput.setCustomValidity(urlValidation.error || '无效 URL')
      urlInput.reportValidity()
      return
    }

    if (editingIndex !== null) {
      updateCustomProvider(editingIndex, {
        name,
        url,
        icon,
        color: { dark: darkColor, light: lightColor }
      })
      await window.electronAPI.saveProviderSettings(getState().providerSettings)
    } else {
      const key = 'custom_' + crypto.randomUUID()
      addCustomProvider({
        key,
        name,
        url,
        icon,
        color: { dark: darkColor, light: lightColor }
      })
      await window.electronAPI.saveProviderSettings(getState().providerSettings)
    }

    hideAddProviderModal()
  })

  fetchIconBtn?.addEventListener('click', async () => {
    const urlInputEl = byIdOrNull<HTMLInputElement>('providerUrl')
    const iconInputEl = byIdOrNull<HTMLInputElement>('providerIcon')
    if (!urlInputEl || !iconInputEl) return

    const url = urlInputEl.value.trim()
    if (!url) return

    try {
      const iconUrl = await window.electronAPI.fetchFavicon(url)
      if (iconUrl) {
        iconInputEl.value = iconUrl
      }
    } catch { /* ignore */ }
  })
}
