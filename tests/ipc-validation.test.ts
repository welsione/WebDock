import { describe, it, expect } from 'vitest'
import {
  sanitizeEnabled, sanitizeCustomProviders, sanitizeOrder,
  sanitizeBuiltInColors, sanitizeTheme, sanitizeProviderKey,
  sanitizeBoolean, sanitizeNumber
} from '../electron/ipc-validation'

describe('sanitizeEnabled', () => {
  it('接受字符串数组', () => {
    expect(sanitizeEnabled(['deepseek', 'kimi'])).toEqual(['deepseek', 'kimi'])
  })
  it('接受 null（全部启用）', () => {
    expect(sanitizeEnabled(null)).toBeNull()
  })
  it('拒绝 undefined——防止 handler 中 .includes 崩溃', () => {
    expect(sanitizeEnabled(undefined)).toBeNull()
  })
  it('拒绝非数组', () => {
    expect(sanitizeEnabled('deepseek')).toBeNull()
    expect(sanitizeEnabled(123)).toBeNull()
  })
  it('拒绝含非字符串元素的数组', () => {
    expect(sanitizeEnabled(['a', 1] as unknown as string[])).toBeNull()
  })
})

describe('sanitizeCustomProviders', () => {
  it('保留合法项', () => {
    const result = sanitizeCustomProviders([
      { key: 'c1', name: 'C1', url: 'http://127.0.0.1:11434', icon: 'data:image/png;base64,AA', color: { dark: '#000', light: '#fff' } }
    ])
    expect(result).toEqual([
      { key: 'c1', name: 'C1', url: 'http://127.0.0.1:11434', icon: 'data:image/png;base64,AA', color: { dark: '#000', light: '#fff' } }
    ])
  })
  it('非数组返回空数组', () => {
    expect(sanitizeCustomProviders(undefined)).toEqual([])
    expect(sanitizeCustomProviders('x')).toEqual([])
  })
  it('key/name/url 缺失或非字符串的项被丢弃', () => {
    const result = sanitizeCustomProviders([
      { key: '', name: 'X', url: 'https://x.com' },
      { key: 'ok', name: 123, url: 'https://x.com' },
      { key: 'ok2', name: 'X', url: null },
      null,
      'junk',
      { key: 'good', name: 'G', url: 'https://g.com' }
    ] as unknown as Array<Record<string, unknown>>)
    expect(result).toEqual([{ key: 'good', name: 'G', url: 'https://g.com' }])
  })
  it('icon 可选且保留合法值', () => {
    const result = sanitizeCustomProviders([
      { key: 'a', name: 'A', url: 'https://a.com', icon: 'data:image/svg+xml;base64,QQ==' },
      { key: 'b', name: 'B', url: 'https://b.com', icon: 42 }
    ] as unknown as Array<Record<string, unknown>>)
    expect(result[0].icon).toBe('data:image/svg+xml;base64,QQ==')
    expect(result[1].icon).toBeUndefined()
  })
  it('color 可选且非法时丢弃', () => {
    const result = sanitizeCustomProviders([
      { key: 'a', name: 'A', url: 'https://a.com', color: { dark: '#000', light: '#fff' } },
      { key: 'b', name: 'B', url: 'https://b.com', color: { dark: '#000' } },
      { key: 'c', name: 'C', url: 'https://c.com', color: 'red' }
    ] as unknown as Array<Record<string, unknown>>)
    expect(result[0].color).toEqual({ dark: '#000', light: '#fff' })
    expect(result[1].color).toBeUndefined()
    expect(result[2].color).toBeUndefined()
  })
})

describe('sanitizeOrder', () => {
  it('接受字符串数组', () => {
    expect(sanitizeOrder(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('非数组回退空数组', () => {
    expect(sanitizeOrder(undefined)).toEqual([])
    expect(sanitizeOrder(123)).toEqual([])
    expect(sanitizeOrder(['a', 1] as unknown as string[])).toEqual([])
  })
})

describe('sanitizeBuiltInColors', () => {
  it('保留合法颜色项', () => {
    expect(sanitizeBuiltInColors({ deepseek: { dark: '#111', light: '#eee' } }))
      .toEqual({ deepseek: { dark: '#111', light: '#eee' } })
  })
  it('非法项丢弃', () => {
    expect(sanitizeBuiltInColors({ a: { dark: '#111', light: '#eee' }, b: 'x', c: 1 }))
      .toEqual({ a: { dark: '#111', light: '#eee' } })
  })
  it('全部非法或非对象返回 undefined', () => {
    expect(sanitizeBuiltInColors({ b: 'x' })).toBeUndefined()
    expect(sanitizeBuiltInColors(undefined)).toBeUndefined()
    expect(sanitizeBuiltInColors('x')).toBeUndefined()
  })
})

describe('sanitizeTheme', () => {
  it('仅接受 dark/light', () => {
    expect(sanitizeTheme('dark')).toBe('dark')
    expect(sanitizeTheme('light')).toBe('light')
    expect(sanitizeTheme('system')).toBeNull()
    expect(sanitizeTheme('"><script>alert(1)</script>')).toBeNull()
    expect(sanitizeTheme(undefined)).toBeNull()
    expect(sanitizeTheme(123)).toBeNull()
  })
})

describe('sanitizeProviderKey', () => {
  it('接受非空字符串', () => {
    expect(sanitizeProviderKey('deepseek')).toBe('deepseek')
    expect(sanitizeProviderKey('')).toBeNull()
    expect(sanitizeProviderKey(undefined)).toBeNull()
    expect(sanitizeProviderKey(123)).toBeNull()
  })
})

describe('sanitizeBoolean / sanitizeNumber', () => {
  it('布尔严格校验', () => {
    expect(sanitizeBoolean(true)).toBe(true)
    expect(sanitizeBoolean(false)).toBe(false)
    expect(sanitizeBoolean(1)).toBeNull()
    expect(sanitizeBoolean(undefined)).toBeNull()
  })
  it('数字严格校验', () => {
    expect(sanitizeNumber(3.14)).toBe(3.14)
    expect(sanitizeNumber(0)).toBe(0)
    expect(sanitizeNumber(NaN)).toBeNull()
    expect(sanitizeNumber(Infinity)).toBeNull()
    expect(sanitizeNumber('5')).toBeNull()
  })
})
