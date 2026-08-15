import { describe, it, expect } from 'vitest'
import {
  sanitizeEnabled, sanitizeWebApp, sanitizeLaunch, sanitizeAppSettings,
  sanitizeOrder, sanitizeBuiltInColors, sanitizeTheme, sanitizeWebAppKey,
  sanitizeBoolean, sanitizeNumber
} from '../electron/ipc-validation'

const DEFAULT_SETTINGS: AppSettings = {
  notifyDefaultNative: true,
  audioExclusive: true,
  viewCacheLimit: 0,
  clearNotificationsOnQuit: false
}

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

describe('sanitizeWebApp', () => {
  it('保留合法项（含新字段）', () => {
    const result = sanitizeWebApp({
      key: 'c1', name: 'C1', url: 'http://127.0.0.1:11434',
      icon: 'data:image/png;base64,AA',
      color: { dark: '#000', light: '#fff' },
      notify: { native: false, titleNotify: true },
      permissions: { camera: 'allow', microphone: 'deny', geolocation: 'ask' },
      trustCertificate: true,
      launch: { command: 'ollama serve', cwd: '/tmp', healthUrl: 'http://127.0.0.1:11434', exitWithApp: true },
      preset: true
    })
    expect(result).toEqual({
      key: 'c1', name: 'C1', url: 'http://127.0.0.1:11434',
      icon: 'data:image/png;base64,AA',
      color: { dark: '#000', light: '#fff' },
      notify: { native: false, titleNotify: true },
      permissions: { camera: 'allow', microphone: 'deny', geolocation: 'ask' },
      trustCertificate: true,
      launch: { command: 'ollama serve', cwd: '/tmp', healthUrl: 'http://127.0.0.1:11434', exitWithApp: true },
      preset: true
    })
  })
  it('非对象/缺 key 返回 undefined', () => {
    expect(sanitizeWebApp(undefined)).toBeUndefined()
    expect(sanitizeWebApp('x')).toBeUndefined()
    expect(sanitizeWebApp({ key: '', name: 'X', url: 'https://x.com' })).toBeUndefined()
    expect(sanitizeWebApp({ key: 'ok', name: 123, url: 'https://x.com' })).toBeUndefined()
    expect(sanitizeWebApp({ key: 'ok2', name: 'X', url: null })).toBeUndefined()
  })
  it('icon 可选且保留合法值', () => {
    const result = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', icon: 'data:image/svg+xml;base64,QQ==' })
    expect(result?.icon).toBe('data:image/svg+xml;base64,QQ==')
    const bad = sanitizeWebApp({ key: 'b', name: 'B', url: 'https://b.com', icon: 42 })
    expect(bad?.icon).toBeUndefined()
  })
  it('color 可选且非法时丢弃', () => {
    const ok = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', color: { dark: '#000', light: '#fff' } })
    expect(ok?.color).toEqual({ dark: '#000', light: '#fff' })
    const bad = sanitizeWebApp({ key: 'b', name: 'B', url: 'https://b.com', color: { dark: '#000' } })
    expect(bad?.color).toBeUndefined()
  })
  it('notify 非法类型丢弃，全默认丢弃', () => {
    const bad = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', notify: { native: 'yes' } })
    expect(bad?.notify).toBeUndefined()
    const defaulted = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', notify: { native: true, titleNotify: false } })
    expect(defaulted?.notify).toBeUndefined()
    const partial = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', notify: { titleNotify: true } })
    expect(partial?.notify).toEqual({ native: true, titleNotify: true })
  })
  it('permissions 非法值丢弃整项，全 deny 丢弃', () => {
    const bad = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', permissions: { camera: 'yes' } })
    expect(bad?.permissions).toBeUndefined()
    const allDeny = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', permissions: { camera: 'deny', microphone: 'deny', geolocation: 'deny' } })
    expect(allDeny?.permissions).toBeUndefined()
    const ok = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', permissions: { camera: 'allow' } })
    expect(ok?.permissions).toEqual({ camera: 'allow', microphone: 'deny', geolocation: 'deny' })
  })
  it('trustCertificate/preset 严格布尔', () => {
    const result = sanitizeWebApp({ key: 'a', name: 'A', url: 'https://a.com', trustCertificate: 'yes', preset: 1 })
    expect(result?.trustCertificate).toBeUndefined()
    expect(result?.preset).toBeUndefined()
  })
})

describe('sanitizeLaunch', () => {
  it('command 必填非空字符串', () => {
    expect(sanitizeLaunch({ command: 'dsh web' })).toEqual({ command: 'dsh web' })
    expect(sanitizeLaunch({})).toBeUndefined()
    expect(sanitizeLaunch({ command: '' })).toBeUndefined()
    expect(sanitizeLaunch({ command: 42 })).toBeUndefined()
    expect(sanitizeLaunch(undefined)).toBeUndefined()
  })
  it('cwd/exitWithApp 可选', () => {
    expect(sanitizeLaunch({ command: 'x', cwd: '/tmp', exitWithApp: true }))
      .toEqual({ command: 'x', cwd: '/tmp', exitWithApp: true })
  })
  it('healthUrl 必须 http/https 可解析，非法丢弃', () => {
    expect(sanitizeLaunch({ command: 'x', healthUrl: 'http://127.0.0.1:3080' }).healthUrl).toBe('http://127.0.0.1:3080')
    expect(sanitizeLaunch({ command: 'x', healthUrl: 'ftp://x' }).healthUrl).toBeUndefined()
    expect(sanitizeLaunch({ command: 'x', healthUrl: 'not a url' }).healthUrl).toBeUndefined()
  })
})

describe('sanitizeAppSettings', () => {
  it('非法/缺失回退默认', () => {
    expect(sanitizeAppSettings(undefined, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeAppSettings('x', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeAppSettings({ notifyDefaultNative: 'yes', audioExclusive: false }, DEFAULT_SETTINGS))
      .toEqual({ ...DEFAULT_SETTINGS, audioExclusive: false })
  })
  it('viewCacheLimit 非负整数', () => {
    expect(sanitizeAppSettings({ viewCacheLimit: 5.7 }, DEFAULT_SETTINGS).viewCacheLimit).toBe(5)
    expect(sanitizeAppSettings({ viewCacheLimit: -1 }, DEFAULT_SETTINGS).viewCacheLimit).toBe(0)
    expect(sanitizeAppSettings({ viewCacheLimit: NaN }, DEFAULT_SETTINGS).viewCacheLimit).toBe(0)
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

describe('sanitizeWebAppKey', () => {
  it('接受非空字符串', () => {
    expect(sanitizeWebAppKey('deepseek')).toBe('deepseek')
    expect(sanitizeWebAppKey('')).toBeNull()
    expect(sanitizeWebAppKey(undefined)).toBeNull()
    expect(sanitizeWebAppKey(123)).toBeNull()
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
