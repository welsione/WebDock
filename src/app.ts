import './style.css'
import { getState, setCurrentProvider, updateProviders, updateProviderSettings, setSwitchShortcut } from './state'
import { initToast, toast } from './ui/toast'
import { Theme } from './ui/theme'
import { initLoading, showLoading, hideLoading, showStatus } from './ui/loading'
import { initNav, renderNav, setupLoadingListener, setupProviderUpdateListener } from './ui/nav'
import { setupShortcutRecording } from './ui/shortcuts'
import { initProviderModal } from './ui/provider-modal'
import { renderProviderList, saveProviderOrderFromDOM } from './providers/manager'
import { initUpdateBanner, setupUpdateStatusListener } from './ui/update-banner'

// ===== Initialize UI modules =====
initToast('toastContainer')
initLoading('loadingOverlay', 'loadingText', 'statusIndicator')
initNav('nav')
initProviderModal()
initUpdateBanner(
  'updateBanner',
  'updateBannerText',
  'updateProgress',
  'updateProgressBar',
  'btnUpdateAction',
  'btnUpdateDismiss'
)

// ===== Global error handler =====
window.onerror = (_msg, _source, _lineno, _colno, _error) => {
  hideLoading()
}
window.onunhandledrejection = () => {
  hideLoading()
}

// ===== Focus Mode =====
let focusMode = false
function syncFocusUI(isFocus: boolean): void {
  focusMode = isFocus
  document.body.classList.toggle('focus', isFocus)
}
function toggleFocus(): void {
  syncFocusUI(!focusMode)
  // 统一延迟通知，等待 CSS 动画完成
  setTimeout(() => {
    window.electronAPI.notifySidebarState(focusMode)
  }, 250)
}

// ===== Action Buttons =====
let reloadCooldown = false
document.getElementById('reloadFrame')?.addEventListener('click', () => {
  if (reloadCooldown) return
  reloadCooldown = true
  window.electronAPI.reload()
  showStatus('已重载')
  setTimeout(() => { reloadCooldown = false }, 1000)
})

document.getElementById('pasteClipboard')?.addEventListener('click', async () => {
  const btn = document.getElementById('pasteClipboard') as HTMLButtonElement
  if (btn.disabled) return
  btn.disabled = true
  const result = await window.electronAPI.injectClipboard()
  btn.disabled = false
  if (result.ok) {
    toast('已粘贴剪贴板内容')
  } else {
    toast(result.error || '粘贴失败')
  }
})

document.getElementById('toggleFocus')?.addEventListener('click', e => {
  e.stopPropagation()
  toggleFocus()
})

// ===== Settings Page =====
const settingsPage = document.getElementById('settingsPage') as HTMLElement
const settingsTheme = document.getElementById('settingsTheme') as HTMLElement

function refreshSettings(): void {
  window.electronAPI.getShortcut().then(s => {
    const el = document.getElementById('shortcutInput')
    if (el) {
      el.textContent = s || '未设置'
      el.classList.remove('recording')
    }
  })
  window.electronAPI.getSwitchShortcut().then(s => {
    const el = document.getElementById('switchShortcutInput')
    if (el) {
      el.textContent = s || '未设置'
      el.classList.remove('recording')
      setSwitchShortcut(s || 'Shift+Tab')
    }
  })
  const isDark = Theme.get() === 'dark'
  settingsTheme.classList.toggle('on', isDark)
  const hint = document.getElementById('settingsThemeHint')
  if (hint) hint.textContent = isDark ? '暗色' : '亮色'
  window.electronAPI.getProviderSettings().then(s => {
    updateProviderSettings(s)
    renderProviderList()
  })
}

document.getElementById('toggleSettings')?.addEventListener('click', () => {
  refreshSettings()
  settingsPage.classList.add('visible')
  window.electronAPI.toggleSettings(true)
})

document.getElementById('btnSettingsBack')?.addEventListener('click', () => {
  settingsPage.classList.remove('visible')
  window.electronAPI.toggleSettings(false)
})

settingsTheme.addEventListener('click', () => {
  Theme.toggle()
  const isDark = Theme.get() === 'dark'
  settingsTheme.classList.toggle('on', isDark)
  const hint = document.getElementById('settingsThemeHint')
  if (hint) hint.textContent = isDark ? '暗色' : '亮色'
})

// ===== Shortcut Recording =====
setupShortcutRecording(
  'shortcutInput',
  () => [],
  () => {},
  acc => window.electronAPI.setShortcut(acc),
  () => window.electronAPI.getShortcut(),
  '快捷键已更新'
)

let switchShortcutKeys: string[] = []
setupShortcutRecording(
  'switchShortcutInput',
  () => switchShortcutKeys,
  v => { switchShortcutKeys = v },
  acc => window.electronAPI.setSwitchShortcut(acc).then(r => {
    if (r.ok) setSwitchShortcut(acc)
    return r
  }),
  () => window.electronAPI.getSwitchShortcut(),
  '切换快捷键已更新'
)

// ===== Settings page check update =====
document.getElementById('btnCheckUpdate')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnCheckUpdate') as HTMLButtonElement
  const hint = document.getElementById('updateHint') as HTMLElement
  btn.textContent = '检查中…'
  btn.disabled = true
  hint.textContent = '正在连接更新服务器…'
  const result = await window.electronAPI.checkUpdate()
  if (!result.ok) {
    hint.textContent = '检查失败，请稍后重试'
  } else if (result.hasUpdate) {
    hint.textContent = '发现新版本，请查看顶部更新提示'
  } else {
    hint.textContent = '当前已是最新版本'
  }
  btn.textContent = '检查更新'
  btn.disabled = false
})

// ===== Provider settings refresh listener =====
document.addEventListener('settings-refresh-providers', () => {
  window.electronAPI.getProviderSettings().then(s => {
    updateProviderSettings(s)
    renderProviderList()
  })
})

document.addEventListener('provider-settings-changed', () => {
  renderProviderList()
  saveProviderOrderFromDOM()
})

// ===== IPC Events =====
setupLoadingListener()
setupProviderUpdateListener()
setupUpdateStatusListener()

window.electronAPI.onModeChange(mode => {
  document.body.dataset.mode = mode
})

window.electronAPI.onCurrentProviderChanged(key => {
  setCurrentProvider(key)
  renderNav(getState().providerStatus)
})

window.electronAPI.onSidebarColor(color => {
  const sidebar = document.querySelector('.sidebar') as HTMLElement
  if (sidebar) sidebar.style.background = color
})

window.electronAPI.onExitFocusMode(() => syncFocusUI(false))

// ===== Switch provider shortcut =====
function matchShortcut(e: KeyboardEvent, acc: string): boolean {
  if (!acc) return false
  const parts = acc.split('+')
  const mods: Record<string, boolean> = { Meta: e.metaKey, Control: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey }
  const expectedMods = parts.filter(p => ['Meta', 'Control', 'Alt', 'Shift'].includes(p))
  const expectedKey = parts.find(p => !['Meta', 'Control', 'Alt', 'Shift'].includes(p))
  if (!expectedKey) return false
  for (const m of ['Meta', 'Control', 'Alt', 'Shift']) {
    if (mods[m] !== expectedMods.includes(m)) return false
  }
  const keyCode = e.code.startsWith('Key') ? e.code.slice(3) : e.code
  return keyCode === expectedKey
}

function cycleProvider(): void {
  const { providers, currentProviderKey } = getState()
  if (providers.length === 0) return
  const idx = providers.findIndex(p => p.key === currentProviderKey)
  const next = providers[(idx + 1) % providers.length]
  if (next.key !== currentProviderKey) {
    setCurrentProvider(next.key)
    window.electronAPI.switchProvider(next.key)
  }
}

document.addEventListener('keydown', e => {
  if (matchShortcut(e, getState().switchShortcut)) {
    e.preventDefault()
    cycleProvider()
  }
})

// ===== Init =====
async function init(): Promise<void> {
  const state = getState()
  state.providers = await window.electronAPI.getProviders()
  state.currentProviderKey = await window.electronAPI.getCurrentProvider()
  const mode = await window.electronAPI.getMode()
  document.body.dataset.mode = mode

  const version = await window.electronAPI.getVersion()
  const verEl = document.getElementById('appVersion')
  if (verEl) verEl.textContent = `v${version}`

  renderNav(state.providerStatus)
  Theme.apply()
  Theme.listenSystemTheme()
  const ss = await window.electronAPI.getSwitchShortcut()
  setSwitchShortcut(ss || 'Shift+Tab')

  window.electronAPI.notifyThemeChange(Theme.get())
}

init()
