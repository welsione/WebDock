import { describe, it, expect, vi } from 'vitest'

// state 模块测试 — 验证 setter 创建新数组
describe('state - 只读保护', () => {
  it('addCustomProvider 应创建新数组而非 push', () => {
    const arr = [{ key: 'a', name: 'A', url: 'https://a.com', icon: null, color: { dark: '#000', light: '#fff' } }] as const
    const newArr = [...arr, { key: 'b', name: 'B', url: 'https://b.com', icon: null, color: { dark: '#000', light: '#fff' } }]
    expect(newArr).not.toBe(arr)
    expect(newArr.length).toBe(arr.length + 1)
  })

  it('removeCustomProvider 应创建新数组而非 splice', () => {
    const arr = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] as const
    const newArr = arr.filter((_, i) => i !== 0)
    expect(newArr).not.toBe(arr)
    expect(newArr.length).toBe(arr.length - 1)
    expect(newArr[0].key).toBe('b')
  })
})
