import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as LoadingModule from '../src/ui/loading'
import { MIN_LOADING_MS, STATUS_DURATION_MS } from '../src/utils/constants'

// loading 模块持有模块级单例状态（loadingCount/timer），每个测试重载模块保证隔离
async function loadLoading(): Promise<typeof LoadingModule> {
  vi.resetModules()
  return await import('../src/ui/loading')
}

function makeEl() {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
    textContent: ''
  }
}

let loading: typeof LoadingModule
let overlay: ReturnType<typeof makeEl>
let text: ReturnType<typeof makeEl>
let status: ReturnType<typeof makeEl>

beforeEach(async () => {
  vi.useFakeTimers()
  loading = await loadLoading()
  overlay = makeEl()
  text = makeEl()
  status = makeEl()
  loading.initLoading(overlay as unknown as HTMLElement, text as unknown as HTMLElement, status as unknown as HTMLElement)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loading - 并发计数', () => {
  it('首次 showLoading 显示遮罩并更新文本', () => {
    loading.showLoading('加载中')
    expect(overlay.classList.add).toHaveBeenCalledWith('visible')
    expect(text.textContent).toBe('加载中')
  })

  it('两次 show 一次 hide 时遮罩保持显示', () => {
    loading.showLoading('A')
    loading.showLoading('B')
    loading.hideLoading()
    expect(overlay.classList.remove).not.toHaveBeenCalledWith('visible')
    expect(text.textContent).toBe('B')
  })

  it('两次 show 两次 hide 后遮罩隐藏', () => {
    loading.showLoading()
    loading.showLoading()
    vi.advanceTimersByTime(MIN_LOADING_MS)
    loading.hideLoading()
    loading.hideLoading()
    vi.advanceTimersByTime(1)
    expect(overlay.classList.remove).toHaveBeenCalledWith('visible')
  })
})

describe('loading - 最小显示时间', () => {
  it('立即 hide 时延迟到最小显示时间后才隐藏', () => {
    loading.showLoading()
    loading.hideLoading()
    // 尚未到最小显示时间
    expect(overlay.classList.remove).not.toHaveBeenCalledWith('visible')
    vi.advanceTimersByTime(MIN_LOADING_MS)
    expect(overlay.classList.remove).toHaveBeenCalledWith('visible')
  })

  it('超过最小显示时间后 hide 立即隐藏', () => {
    loading.showLoading()
    vi.advanceTimersByTime(MIN_LOADING_MS + 100)
    loading.hideLoading()
    vi.advanceTimersByTime(1)
    expect(overlay.classList.remove).toHaveBeenCalledWith('visible')
  })

  it('hideLoading 在无加载时安全 no-op', () => {
    expect(() => loading.hideLoading()).not.toThrow()
  })
})

describe('loading - showStatus', () => {
  it('显示后按固定时长自动隐藏', () => {
    loading.showStatus('已重载')
    expect(status.classList.add).toHaveBeenCalledWith('visible')
    expect(status.textContent).toBe('已重载')
    vi.advanceTimersByTime(STATUS_DURATION_MS)
    expect(status.classList.remove).toHaveBeenCalledWith('visible')
  })
})

describe('loading - 未初始化保护', () => {
  it('未 init 时 showLoading/hideLoading 安全 no-op', () => {
    loading.initLoading(null, null, null)
    expect(() => {
      loading.showLoading()
      loading.hideLoading()
      loading.showStatus('x')
    }).not.toThrow()
  })
})
