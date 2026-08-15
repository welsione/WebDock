// ===== 更新状态横幅 =====

import { byIdOrNull } from '../utils/dom'

let updateBanner: HTMLElement | null = null
let updateBannerText: HTMLElement | null = null
let updateProgress: HTMLElement | null = null
let updateProgressBar: HTMLElement | null = null
let btnUpdateAction: HTMLElement | null = null
let btnUpdateDismiss: HTMLElement | null = null

export function initUpdateBanner(
  bannerId: HTMLElement | null,
  textId: HTMLElement | null,
  progressId: HTMLElement | null,
  progressBarId: HTMLElement | null,
  actionId: HTMLElement | null,
  dismissId: HTMLElement | null
): void {
  updateBanner = bannerId
  updateBannerText = textId
  updateProgress = progressId
  updateProgressBar = progressBarId
  btnUpdateAction = actionId
  btnUpdateDismiss = dismissId

  btnUpdateDismiss?.addEventListener('click', () => {
    updateBanner?.classList.remove('visible')
  })

  btnUpdateAction?.addEventListener('click', async () => {
    if (!btnUpdateAction) return
    const text = btnUpdateAction.textContent
    if (text === '下载更新') {
      btnUpdateAction.textContent = '下载中…'
      if (btnUpdateAction instanceof HTMLButtonElement) btnUpdateAction.disabled = true
      const result = await window.electronAPI.downloadUpdate()
      if (!result.ok) {
        btnUpdateAction.textContent = '下载更新'
        if (btnUpdateAction instanceof HTMLButtonElement) btnUpdateAction.disabled = false
        if (updateBannerText) updateBannerText.textContent = '下载失败，请稍后重试'
      }
    } else if (text === '安装并重启') {
      window.electronAPI.installUpdate()
    }
  })
}

export function setupUpdateStatusListener(): void {
  window.electronAPI.onUpdateStatus(data => {
    const status = (data as { status: string; version?: string; percent?: number; error?: string }).status
    const version = (data as { version?: string }).version
    const percent = (data as { percent?: number }).percent

    const btn = byIdOrNull<HTMLElement>('btnCheckUpdate')
    const hint = byIdOrNull<HTMLElement>('updateHint')

    if (status === 'available') {
      if (hint) hint.textContent = `新版本 v${version} 可用`
      if (btn) { btn.textContent = '下载更新'; if (btn instanceof HTMLButtonElement) btn.disabled = false }
      if (updateBannerText) {
        updateBannerText.innerHTML = ''
        updateBannerText.appendChild(document.createTextNode('发现新版本 '))
        const strong = document.createElement('strong')
        strong.textContent = `v${version}`
        updateBannerText.appendChild(strong)
      }
      if (btnUpdateAction) { btnUpdateAction.textContent = '下载更新'; if (btnUpdateAction instanceof HTMLButtonElement) btnUpdateAction.disabled = false; btnUpdateAction.style.display = '' }
      if (updateProgress) updateProgress.style.display = 'none'
      if (updateBanner) updateBanner.classList.add('visible')
    } else if (status === 'none') {
      if (hint) hint.textContent = '已是最新版本'
      if (btn) { btn.textContent = '检查更新'; if (btn instanceof HTMLButtonElement) btn.disabled = false }
    } else if (status === 'downloading') {
      const p = percent != null ? Math.round(percent) : 0
      if (hint) hint.textContent = `正在下载… ${p}%`
      if (btn) { btn.textContent = '下载中…'; if (btn instanceof HTMLButtonElement) btn.disabled = true }
      if (updateBannerText) updateBannerText.textContent = '正在下载更新…'
      if (updateProgress) updateProgress.style.display = 'block'
      if (updateProgressBar) updateProgressBar.style.width = `${p}%`
      if (btnUpdateAction) btnUpdateAction.style.display = 'none'
    } else if (status === 'downloaded') {
      if (hint) hint.textContent = '更新已就绪，重启即可安装'
      if (btn) { btn.textContent = '安装并重启'; if (btn instanceof HTMLButtonElement) btn.disabled = false }
      if (updateBannerText) updateBannerText.textContent = '更新已下载，重启即可安装'
      if (updateProgress) updateProgress.style.display = 'none'
      if (btnUpdateAction) { btnUpdateAction.textContent = '安装并重启'; if (btnUpdateAction instanceof HTMLButtonElement) btnUpdateAction.disabled = false; btnUpdateAction.style.display = '' }
    } else if (status === 'error') {
      if (hint) hint.textContent = '检查失败，请稍后重试'
      if (btn) { btn.textContent = '检查更新'; if (btn instanceof HTMLButtonElement) btn.disabled = false }
      if (updateBannerText) updateBannerText.textContent = '更新检查失败，请稍后重试'
      if (btnUpdateAction) btnUpdateAction.style.display = 'none'
      if (updateProgress) updateProgress.style.display = 'none'
      setTimeout(() => updateBanner?.classList.remove('visible'), 5000)
    }
  })
}
