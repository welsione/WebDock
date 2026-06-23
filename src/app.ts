import './style.css'
import { getState, setCurrentProvider, updateProviders, updateProviderSettings, setSwitchShortcut } from './state'
import { initToast, toast } from './ui/toast'
import { Theme } from './ui/theme'
import { initLoading, showLoading, hideLoading, showStatus } from './ui/loading'
import { initNav, renderNav, setupLoadingListener, setupProviderUpdateListener } from './ui/nav'
import { setupShortcutRecording } from './ui/shortcuts'
import { initUpdateBanner, setupUpdateStatusListener } from './ui/update-banner'
import { byIdOrNull } from './utils/dom'

// ===== Initialize UI modules =====
const toastContainer = byIdOrNull<HTMLElement>('toastContainer')
if (toastContainer) initToast(toastContainer)

const loadingEl = byIdOrNull<HTMLElement>('loadingOverlay')
const loadingTextEl = byIdOrNull<HTMLElement>('loadingText')
const statusEl = byIdOrNull<HTMLElement>('statusIndicator')
if (loadingEl && loadingTextEl && statusEl) {
  initLoading(loadingEl, loadingTextEl, statusEl)
}

const navEl = byIdOrNull<HTMLElement>('nav')
if (navEl) initNav(navEl)

initUpdateBanner(
  byIdOrNull('updateBanner'),
  byIdOrNull('updateBannerText'),
  byIdOrNull('updateProgress'),
  byIdOrNull('updateProgressBar'),
  byIdOrNull('btnUpdateAction'),
  byIdOrNull('btnUpdateDismiss')
)

// ===== Global error handler =====
window.onerror = () => hideLoading()
window.onunhandledrejection = () => hideLoading()

// ===== Focus Mode =====
let focusMode = false
function syncFocusUI(isFocus: boolean): void {
  focusMode = isFocus
  document.body.classList.toggle('focus', isFocus)
}
function toggleFocus(): void {
  syncFocusUI(!focusMode)
  setTimeout(() => {
    window.electronAPI.notifySidebarState(focusMode)
  }, 250)
}

// ===== Action Buttons =====
let reloadCooldown = false
byIdOrNull<HTMLButtonElement>('reloadFrame')?.addEventListener('click', () => {
  if (reloadCooldown) return
  reloadCooldown = true
  window.electronAPI.reload()
  showStatus('已重载')
  setTimeout(() => { reloadCooldown = false }, 1000)
})

byIdOrNull<HTMLButtonElement>('pasteClipboard')?.addEventListener('click', async () => {
  const btn = byIdOrNull<HTMLButtonElement>('pasteClipboard')
  if (!btn || btn.disabled) return
  btn.disabled = true
  const result = await window.electronAPI.injectClipboard()
  btn.disabled = false
  if (result.ok) toast('已粘贴剪贴板内容')
  else toast(result.error || '粘贴失败')
})

byIdOrNull<HTMLButtonElement>('toggleFocus')?.addEventListener('click', e => {
  e.stopPropagation()
  toggleFocus()
})

// ===== Settings Page =====
const settingsPage = byIdOrNull<HTMLElement>('settingsPage')
const settingsTheme = byIdOrNull<HTMLElement>('settingsTheme')

function refreshSettings(): void {
  window.electronAPI.getShortcut().then(s => {
    const el = byIdOrNull<HTMLElement>('shortcutInput')
    if (el) { el.textContent = s || '未设置'; el.classList.remove('recording') }
  })
  window.electronAPI.getSwitchShortcut().then(s => {
    const el = byIdOrNull<HTMLElement>('switchShortcutInput')
    if (el) { el.textContent = s || '未设置'; el.classList.remove('recording'); setSwitchShortcut(s || 'Shift+Tab') }
  })
  if (settingsTheme) {
    const isDark = Theme.get() === 'dark'
    settingsTheme.classList.toggle('on', isDark)
    const hint = byIdOrNull<HTMLElement>('settingsThemeHint')
    if (hint) hint.textContent = isDark ? '暗色' : '亮色'
  }
  window.electronAPI.getProviderSettings().then(s => {
    updateProviderSettings(s)
    document.dispatchEvent(new CustomEvent('settings-refresh-providers'))
  })
}

byIdOrNull<HTMLButtonElement>('toggleSettings')?.addEventListener('click', () => {
  refreshSettings()
  settingsPage?.classList.add('visible')
  window.electronAPI.toggleSettings(true)
})

byIdOrNull<HTMLButtonElement>('btnSettingsBack')?.addEventListener('click', () => {
  settingsPage?.classList.remove('visible')
  window.electronAPI.toggleSettings(false)
})

settingsTheme?.addEventListener('click', () => {
  Theme.toggle()
  if (settingsTheme) {
    const isDark = Theme.get() === 'dark'
    settingsTheme.classList.toggle('on', isDark)
    const hint = byIdOrNull<HTMLElement>('settingsThemeHint')
    if (hint) hint.textContent = isDark ? '暗色' : '亮色'
  }
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
byIdOrNull<HTMLButtonElement>('btnCheckUpdate')?.addEventListener('click', async () => {
  const btn = byIdOrNull<HTMLButtonElement>('btnCheckUpdate')
  const hint = byIdOrNull<HTMLElement>('updateHint')
  if (!btn) return
  btn.textContent = '检查中…'
  btn.disabled = true
  if (hint) hint.textContent = '正在连接更新服务器…'
  const result = await window.electronAPI.checkUpdate()
  if (hint) {
    if (!result.ok) hint.textContent = '检查失败，请稍后重试'
    else if (result.hasUpdate) hint.textContent = '发现新版本，请查看顶部更新提示'
    else hint.textContent = '当前已是最新版本'
  }
  btn.textContent = '检查更新'
  btn.disabled = false
})

// ===== Provider settings refresh listener =====
document.addEventListener('settings-refresh-providers', () => {
  window.electronAPI.getProviderSettings().then(s => {
    updateProviderSettings(s)
    document.dispatchEvent(new CustomEvent('provider-settings-changed'))
  })
})

document.addEventListener('provider-settings-changed', () => {
  // 通知 manager 重新渲染
  const { renderProviderList } = require('./providers/manager') as typeof import('./providers/manager')
  renderProviderList()
  const { saveProviderOrderFromDOM } = require('./providers/manager') as typeof import('./providers/manager')
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
  const sidebar = document.querySelector('.sidebar') as HTMLElement | null
  if (sidebar) sidebar.style.background = color
})

window.electronAPI.onExitFocusMode(() => syncFocusUI(false))

// ===== Init =====
async function init(): Promise<void> {
  const state = getState()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(state as any).providers = await window.electronAPI.getProviders()
  setCurrentProvider(await window.electronAPI.getCurrentProvider())
  const mode = await window.electronAPI.getMode()
  document.body.dataset.mode = mode

  const version = await window.electronAPI.getVersion()
  const verEl = byIdOrNull<HTMLElement>('appVersion')
  if (verEl) verEl.textContent = `v${version}`

  renderNav(state.providerStatus)
  Theme.apply()
  Theme.listenSystemTheme()
  const ss = await window.electronAPI.getSwitchShortcut()
  setSwitchShortcut(ss || 'Shift+Tab')

  window.electronAPI.notifyThemeChange(Theme.get())
}

init().catch(e => {
  console.error('App init failed:', e)
  toast('应用初始化失败，请重启')
})
