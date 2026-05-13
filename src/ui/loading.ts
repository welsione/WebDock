let loadingOverlay: HTMLElement
let loadingText: HTMLElement
let statusIndicator: HTMLElement

let isLoading = false
let loadingStartTime = 0
const MIN_LOADING_MS = 200
let hideLoadingTimer: ReturnType<typeof setTimeout> | null = null

export function initLoading(overlayId: string, textId: string, statusId: string): void {
  loadingOverlay = document.getElementById(overlayId) as HTMLElement
  loadingText = document.getElementById(textId) as HTMLElement
  statusIndicator = document.getElementById(statusId) as HTMLElement
}

export function showLoading(text = '正在加载…'): void {
  if (hideLoadingTimer) clearTimeout(hideLoadingTimer)
  isLoading = true
  loadingStartTime = Date.now()
  loadingOverlay.classList.add('visible')
  loadingText.textContent = text
}

export function hideLoading(): void {
  const elapsed = Date.now() - loadingStartTime
  const delay = Math.max(0, MIN_LOADING_MS - elapsed)
  if (hideLoadingTimer) clearTimeout(hideLoadingTimer)
  hideLoadingTimer = setTimeout(() => {
    isLoading = false
    loadingOverlay.classList.remove('visible')
  }, delay)
}

export function showStatus(text: string, duration = 2000): void {
  statusIndicator.textContent = text
  statusIndicator.classList.add('visible')
  setTimeout(() => {
    statusIndicator.classList.remove('visible')
  }, duration)
}
