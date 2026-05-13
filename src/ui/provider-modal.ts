import { getState } from '../state'
import { toast } from './toast'

let modalIconData: string | null = null
let modalMode: 'add' | 'edit' = 'add'
let modalEditTarget: { key: string; type: 'builtin' | 'custom'; index: number } | null = null

export function initProviderModal(): void {
  // 颜色选择器同步 hex 显示
  ;['modalColorDark', 'modalColorLight'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      const hexId = id === 'modalColorDark' ? 'modalColorDarkHex' : 'modalColorLightHex'
      const hexEl = document.getElementById(hexId)
      if (hexEl) hexEl.textContent = (e.target as HTMLInputElement).value
    })
  })

  document.getElementById('btnAddProvider')?.addEventListener('click', openAddModal)
  document.getElementById('modalClose')?.addEventListener('click', closeModal)
  document.getElementById('modalCancel')?.addEventListener('click', closeModal)
  document.getElementById('addProviderModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('addProviderModal')) closeModal()
  })

  // 图标预览点击上传
  document.getElementById('iconPreview')?.addEventListener('click', () => {
    ;(document.getElementById('iconFileInput') as HTMLInputElement)?.click()
  })
  document.getElementById('iconFileInput')?.addEventListener('change', e => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      modalIconData = reader.result as string
      const preview = document.getElementById('iconPreview')
      if (preview) preview.innerHTML = `<img src="${modalIconData}" alt="预览">`
    }
    reader.readAsDataURL(file)
  })

  // 从 URL 获取图标
  document.getElementById('btnFetchIcon')?.addEventListener('click', async () => {
    let iconUrl = (document.getElementById('modalIconUrl') as HTMLInputElement).value.trim()
    if (!iconUrl) return
    if (!/^https?:\/\//.test(iconUrl)) iconUrl = 'https://' + iconUrl
    const btn = document.getElementById('btnFetchIcon') as HTMLButtonElement
    btn.textContent = '…'
    btn.disabled = true
    const result = await window.electronAPI.fetchIconUrl(iconUrl)
    if (result) {
      modalIconData = result
      const preview = document.getElementById('iconPreview')
      if (preview) preview.innerHTML = `<img src="${modalIconData}" alt="预览">`
    }
    btn.textContent = '获取'
    btn.disabled = false
  })

  // 保存
  document.getElementById('modalSave')?.addEventListener('click', handleSave)
}

export function openAddModal(): void {
  modalMode = 'add'
  modalEditTarget = null
  setText('modalTitle', '添加自定义服务商')
  setText('modalSave', '添加')
  showFields(true)
  setInput('modalName', '')
  setInput('modalUrl', '')
  setInput('modalIconUrl', '')
  modalIconData = null
  setHtml('iconPreview', '?')
  setColor('modalColorDark', '#1a1e28', 'modalColorDarkHex')
  setColor('modalColorLight', '#f0f2f5', 'modalColorLightHex')
  document.getElementById('addProviderModal')?.classList.add('visible')
  ;(document.getElementById('modalName') as HTMLInputElement)?.focus()
}

export function openEditModal(item: {
  type: 'builtin' | 'custom'
  key: string
  name: string
  url: string
  icon: string | null
  color: { dark: string; light: string }
  index?: number
}): void {
  modalMode = 'edit'
  modalEditTarget = { key: item.key, type: item.type, index: item.index ?? 0 }
  const isBuiltin = item.type === 'builtin'

  setText('modalTitle', isBuiltin ? `编辑 ${item.name}` : '编辑服务商')
  setText('modalSave', '保存')
  showFields(!isBuiltin)
  setInput('modalName', item.name || '')
  setInput('modalUrl', item.url || '')
  setInput('modalIconUrl', '')
  modalIconData = null

  if (item.icon && item.icon.startsWith('data:')) {
    setHtml('iconPreview', `<img src="${item.icon}" alt="预览">`)
  } else {
    setHtml('iconPreview', item.name ? item.name[0].toUpperCase() : '?')
  }

  const color = item.color || { dark: '#1a1e28', light: '#f0f2f5' }
  setColor('modalColorDark', color.dark || '#1a1e28', 'modalColorDarkHex')
  setColor('modalColorLight', color.light || '#f0f2f5', 'modalColorLightHex')

  document.getElementById('addProviderModal')?.classList.add('visible')
}

export function closeModal(): void {
  document.getElementById('addProviderModal')?.classList.remove('visible')
}

function showFields(show: boolean): void {
  const display = show ? '' : 'none'
  setDisplay('modalFieldGroup', display)
  setDisplay('modalFieldUrl', display)
  setDisplay('modalFieldIcon', display)
  setDisplay('modalColorRow', '')
}

async function handleSave(): Promise<void> {
  const btn = document.getElementById('modalSave') as HTMLButtonElement
  try {
    const colorDark = getInput('modalColorDark')
    const colorLight = getInput('modalColorLight')
    const newColor = { dark: colorDark, light: colorLight }

    if (modalMode === 'add') {
      const name = getInput('modalName').trim()
      let url = getInput('modalUrl').trim()
      if (!name || !url) return
      if (!/^https?:\/\//.test(url)) url = 'https://' + url
      btn.textContent = '添加中…'
      btn.disabled = true
      let icon = modalIconData
      if (!icon) {
        icon = await window.electronAPI.fetchFavicon(url)
      }
      const key = 'custom_' + Date.now()
      getState().providerSettings.custom.push({ key, name, url, icon: icon || null, color: newColor })
      document.dispatchEvent(new CustomEvent('provider-settings-changed'))
      closeModal()
      toast(`已添加 ${name}`)
    } else {
      const { key, type, index } = modalEditTarget!
      const { providerSettings } = getState()
      if (type === 'builtin') {
        const p = providerSettings.builtIn.find(x => x.key === key)
        if (p) {
          p.color = newColor
        }
        await window.electronAPI.saveProviderSettings({
          enabled: providerSettings.enabled,
          custom: providerSettings.custom,
          builtInColors: providerSettings.builtIn.reduce<Record<string, { dark: string; light: string }>>((acc, p) => {
            if (p.color) acc[p.key] = p.color
            return acc
          }, {})
        })
      } else {
        const p = providerSettings.custom[index]
        if (p) {
          const name = getInput('modalName').trim()
          let url = getInput('modalUrl').trim()
          if (!name || !url) return
          if (!/^https?:\/\//.test(url)) url = 'https://' + url
          p.name = name
          p.url = url
          p.color = newColor
          if (modalIconData) p.icon = modalIconData
        }
        document.dispatchEvent(new CustomEvent('provider-settings-changed'))
      }
      closeModal()
      toast('已保存')
      // 即时更新侧边栏颜色
      if (key === getState().currentProviderKey) {
        const sidebar = document.querySelector('.sidebar') as HTMLElement
        if (sidebar) {
          const themeKey = document.documentElement.dataset.theme || 'dark'
          sidebar.style.background = newColor[themeKey as keyof typeof newColor] || newColor.dark
        }
      }
    }
  } catch (e) {
    console.error('Failed to save provider:', e)
    toast('添加失败，请重试')
  } finally {
    btn.textContent = modalMode === 'add' ? '添加' : '保存'
    btn.disabled = false
  }
}

// DOM helpers
function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}
function setHtml(id: string, html: string): void {
  const el = document.getElementById(id)
  if (el) el.innerHTML = html
}
function setInput(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLInputElement
  if (el) el.value = value
}
function getInput(id: string): string {
  return (document.getElementById(id) as HTMLInputElement)?.value || ''
}
function setColor(inputId: string, value: string, hexId: string): void {
  const el = document.getElementById(inputId) as HTMLInputElement
  if (el) el.value = value
  setText(hexId, value)
}
function setDisplay(id: string, display: string): void {
  const el = document.getElementById(id)
  if (el) el.style.display = display
}
