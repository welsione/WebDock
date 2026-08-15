import './style.css'
import {
  setCurrentWebApp, updateWebApps, updateWebAppSettings, setSwitchShortcut
} from './state'
import { renderWebAppList, saveWebAppOrderFromDOM } from './providers/manager'
import { initToast, toast } from './ui/toast'
import { Theme } from './ui/theme'
import { initLoading, hideLoading, showLoading, showStatus } from './ui/loading'
import { initNav, renderNav, setupLoadingListener, setupWebAppUpdateListener } from './ui/nav'
import { setupShortcutRecording } from './ui/shortcuts'
import { initUpdateBanner, setupUpdateStatusListener } from './ui/update-banner'
import { initWebAppModal } from './ui/provider-modal'
import { FOCUS_NOTIFY_DELAY_MS, RELOAD_COOLDOWN_MS } from './utils/constants'
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

initWebAppModal()

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
  }, FOCUS_NOTIFY_DELAY_MS)
}

// ===== Action Buttons =====
let reloadCooldown = false
byIdOrNull<HTMLButtonElement>('reloadFrame')?.addEventListener('click', () => {
  if (reloadCooldown) return
  reloadCooldown = true
  window.electronAPI.reload()
  showStatus('已重载')
  setTimeout(() => { reloadCooldown = false }, RELOAD_COOLDOWN_MS)
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
  window.electronAPI.getWebAppSettings().then(s => {
    updateWebAppSettings(s)
    document.dispatchEvent(new CustomEvent('settings-refresh-webapps'))
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

// 数据导出/导入
byIdOrNull<HTMLButtonElement>('btnExportData')?.addEventListener('click', async () => {
  const r = await window.electronAPI.exportData()
  toast(r.ok ? '配置已导出' : (r.error || '导出失败'))
})
byIdOrNull<HTMLButtonElement>('btnImportData')?.addEventListener('click', async () => {
  const r = await window.electronAPI.importData()
  if (r.ok) {
    toast('配置已导入')
    refreshSettings()
  } else {
    toast(r.error || '导入失败')
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

// ===== Settings refresh listeners =====
document.addEventListener('settings-refresh-webapps', () => {
  window.electronAPI.getWebAppSettings().then(s => {
    updateWebAppSettings(s)
    document.dispatchEvent(new CustomEvent('webapp-settings-changed'))
  })
})

document.addEventListener('webapp-settings-changed', () => {
  renderWebAppList()
  saveWebAppOrderFromDOM()
})

// ===== IPC Events =====
setupLoadingListener()
setupWebAppUpdateListener()
setupUpdateStatusListener()

window.electronAPI.onLoading(data => {
  const { app, status } = data as { app: string; status: 'loading' | 'loaded' | 'error' | 'starting' }
  if (status === 'starting') showLoading('正在启动本地服务…')
  else if (status === 'loading') showLoading('正在加载…')
  else hideLoading()
  void app
})

window.electronAPI.onModeChange(mode => {
  document.body.dataset.mode = mode
})

window.electronAPI.onCurrentWebAppChanged(key => {
  setCurrentWebApp(key)
  renderNav()
})

window.electronAPI.onSidebarColor(color => {
  const sidebar = document.querySelector('.sidebar') as HTMLElement | null
  if (sidebar) sidebar.style.background = color
})

window.electronAPI.onExitFocusMode(() => syncFocusUI(false))

// ===== Init =====
async function init(): Promise<void> {
  updateWebApps(await window.electronAPI.getWebApps())
  setCurrentWebApp(await window.electronAPI.getCurrentWebApp())
  const mode = await window.electronAPI.getMode()
  document.body.dataset.mode = mode

  const version = await window.electronAPI.getVersion()
  const verEl = byIdOrNull<HTMLElement>('appVersion')
  if (verEl) verEl.textContent = `v${version}`

  renderNav()
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
