// ===== 加载状态管理 =====
// 支持并发加载计数和最小显示时间

import { byIdOrNull } from '../utils/dom'

let loadingOverlay: HTMLElement | null = null
let loadingText: HTMLElement | null = null
let statusIndicator: HTMLElement | null = null

let loadingCount = 0
let loadingStartTime = 0
const MIN_LOADING_MS = 200
let hideLoadingTimer: ReturnType<typeof setTimeout> | null = null

export function initLoading(overlay: HTMLElement, text: HTMLElement, status: HTMLElement): void {
  loadingOverlay = overlay
  loadingText = text
  statusIndicator = status
}

export function showLoading(text = '正在加载…'): void {
  if (!loadingOverlay || !loadingText) return
  if (hideLoadingTimer) clearTimeout(hideLoadingTimer)
  loadingCount++
  if (loadingCount === 1) {
    loadingStartTime = Date.now()
    loadingOverlay.classList.add('visible')
  }
  loadingText.textContent = text
}

export function hideLoading(): void {
  if (loadingCount === 0) return
  loadingCount--
  if (loadingCount > 0) return
  const elapsed = Date.now() - loadingStartTime
  const delay = Math.max(0, MIN_LOADING_MS - elapsed)
  if (hideLoadingTimer) clearTimeout(hideLoadingTimer)
  hideLoadingTimer = setTimeout(() => {
    hideLoadingTimer = null
    if (loadingOverlay) loadingOverlay.classList.remove('visible')
  }, delay)
}

export function showStatus(text: string, duration = 2000): void {
  if (!statusIndicator) return
  statusIndicator.textContent = text
  statusIndicator.classList.add('visible')
  setTimeout(() => {
    if (statusIndicator) statusIndicator.classList.remove('visible')
  }, duration)
}
