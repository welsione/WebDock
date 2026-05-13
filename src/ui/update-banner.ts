import { getState } from '../state'

let updateBanner: HTMLElement
let updateBannerText: HTMLElement
let updateProgress: HTMLElement
let updateProgressBar: HTMLElement
let btnUpdateAction: HTMLElement
let btnUpdateDismiss: HTMLElement

export function initUpdateBanner(
  bannerId: string,
  textId: string,
  progressId: string,
  progressBarId: string,
  actionId: string,
  dismissId: string
): void {
  updateBanner = document.getElementById(bannerId) as HTMLElement
  updateBannerText = document.getElementById(textId) as HTMLElement
  updateProgress = document.getElementById(progressId) as HTMLElement
  updateProgressBar = document.getElementById(progressBarId) as HTMLElement
  btnUpdateAction = document.getElementById(actionId) as HTMLElement
  btnUpdateDismiss = document.getElementById(dismissId) as HTMLElement

  btnUpdateDismiss.addEventListener('click', () => {
    updateBanner.classList.remove('visible')
  })

  btnUpdateAction.addEventListener('click', async () => {
    const text = btnUpdateAction.textContent
    if (text === '下载更新') {
      btnUpdateAction.textContent = '下载中…'
      ;(btnUpdateAction as HTMLButtonElement).disabled = true
      await window.electronAPI.downloadUpdate()
    } else if (text === '安装并重启') {
      window.electronAPI.installUpdate()
    }
  })
}

export function setupUpdateStatusListener(): void {
  window.electronAPI.onUpdateStatus(data => {
    const btn = document.getElementById('btnCheckUpdate') as HTMLElement
    const hint = document.getElementById('updateHint') as HTMLElement
    const updateBtn = btn as HTMLButtonElement

    if (data.status === 'available') {
      hint.textContent = `新版本 v${data.version} 可用`
      btn.textContent = '下载更新'
      updateBtn.disabled = false
      btn.onclick = () => {
        btn.textContent = '下载中…'
        updateBtn.disabled = true
        window.electronAPI.downloadUpdate()
      }
      updateBannerText.innerHTML = `发现新版本 <strong>v${data.version}</strong>`
      btnUpdateAction.textContent = '下载更新'
      ;(btnUpdateAction as HTMLButtonElement).disabled = false
      updateProgress.style.display = 'none'
      updateBanner.classList.add('visible')
    } else if (data.status === 'none') {
      hint.textContent = '已是最新版本'
      btn.textContent = '检查更新'
      updateBtn.disabled = false
    } else if (data.status === 'downloading') {
      hint.textContent = `正在下载… ${Math.round(data.percent!)}%`
      btn.textContent = '下载中…'
      updateBtn.disabled = true
      updateBannerText.textContent = '正在下载更新…'
      updateProgress.style.display = 'block'
      updateProgressBar.style.width = `${Math.round(data.percent!)}%`
      btnUpdateAction.style.display = 'none'
    } else if (data.status === 'downloaded') {
      hint.textContent = '更新已就绪，重启即可安装'
      btn.textContent = '安装并重启'
      updateBtn.disabled = false
      btn.onclick = () => window.electronAPI.installUpdate()
      updateBannerText.textContent = '更新已下载，重启即可安装'
      updateProgress.style.display = 'none'
      btnUpdateAction.textContent = '安装并重启'
      ;(btnUpdateAction as HTMLButtonElement).disabled = false
      btnUpdateAction.style.display = ''
    } else if (data.status === 'error') {
      hint.textContent = '检查失败，请稍后重试'
      btn.textContent = '检查更新'
      updateBtn.disabled = false
      updateBannerText.textContent = '更新检查失败，请稍后重试'
      btnUpdateAction.style.display = 'none'
      updateProgress.style.display = 'none'
      setTimeout(() => updateBanner.classList.remove('visible'), 5000)
    }
  })
}
