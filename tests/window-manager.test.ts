import { describe, it, expect, vi } from 'vitest'
import type * as WindowManager from '../electron/window-manager'

// isValidBounds 只依赖 screen.getAllDisplays；窗口类仅需存在即可
const displays = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } }
]

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/mock-userdata' },
  BrowserWindow: class {},
  screen: { getAllDisplays: () => displays }
}))

async function loadWindowManager(): Promise<typeof WindowManager> {
  vi.resetModules()
  return await import('../electron/window-manager')
}

type Bounds = { x: number; y: number; width: number; height: number }

describe('isValidBounds', () => {
  it('null 返回 false', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds(null)).toBe(false)
  })

  it('有效边界通过', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds({ x: 100, y: 100, width: 800, height: 600 })).toBe(true)
  })

  it('宽度小于 600 拒绝', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds({ x: 100, y: 100, width: 599, height: 600 })).toBe(false)
  })

  it('高度小于 400 拒绝', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds({ x: 100, y: 100, width: 800, height: 399 })).toBe(false)
  })

  it('完全在屏幕外拒绝', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds({ x: 5000, y: 100, width: 800, height: 600 })).toBe(false)
    expect(isValidBounds({ x: 100, y: 5000, width: 800, height: 600 })).toBe(false)
  })

  it('超出屏幕边缘但中心点在屏内时允许（100px 容差）', async () => {
    const { isValidBounds } = await loadWindowManager()
    // 左边缘越出 -50px，中心仍在屏内
    expect(isValidBounds({ x: -50, y: 100, width: 800, height: 600 })).toBe(true)
  })

  it('超出屏幕右边缘容差（+100px）时拒绝', async () => {
    const { isValidBounds } = await loadWindowManager()
    // 第一屏右边界 1920：x=1430 + width=600 = 2030 > 1920+100=2020，超出容差
    expect(isValidBounds({ x: 1430, y: 100, width: 600, height: 500 })).toBe(false)
    // 恰好卡在容差内（2020）允许
    expect(isValidBounds({ x: 1420, y: 100, width: 600, height: 500 })).toBe(true)
  })

  it('位于第二块显示器内时通过', async () => {
    const { isValidBounds } = await loadWindowManager()
    expect(isValidBounds({ x: 2000, y: 200, width: 800, height: 600 })).toBe(true)
  })
})
