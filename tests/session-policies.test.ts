import { describe, it, expect } from 'vitest'
import { decidePermissionRequest } from '../electron/session-policies'

const mediaAllow = { camera: 'allow', microphone: 'allow', geolocation: 'allow' }
const mediaDeny = { camera: 'deny', microphone: 'deny', geolocation: 'deny' }

describe('decidePermissionRequest', () => {
  it('通知始终放行（通知桥接管，来源主进程反查）', () => {
    expect(decidePermissionRequest('notifications')).toBe(true)
    expect(decidePermissionRequest('notifications', mediaDeny)).toBe(true)
  })

  it('剪贴板写入放行：网页复制按钮依赖 navigator.clipboard.writeText', () => {
    expect(decidePermissionRequest('clipboard-sanitized-write')).toBe(true)
    expect(decidePermissionRequest('clipboard-sanitized-write', undefined)).toBe(true)
  })

  it('兼容旧版 Chromium 权限名 clipboard-write', () => {
    expect(decidePermissionRequest('clipboard-write')).toBe(true)
  })

  it('剪贴板读取不放行（隐私：不允许页面主动读取剪贴板）', () => {
    expect(decidePermissionRequest('clipboard-read')).toBe(false)
    expect(decidePermissionRequest('clipboard-read', mediaAllow)).toBe(false)
  })

  it('媒体权限按每应用配置，默认拒绝', () => {
    expect(decidePermissionRequest('media', mediaAllow)).toBe(true)
    expect(decidePermissionRequest('media', { camera: 'allow', microphone: 'deny', geolocation: 'deny' })).toBe(true)
    expect(decidePermissionRequest('media', { camera: 'deny', microphone: 'allow', geolocation: 'deny' })).toBe(true)
    expect(decidePermissionRequest('media', mediaDeny)).toBe(false)
    expect(decidePermissionRequest('media')).toBe(false)
    expect(decidePermissionRequest('media', { camera: 'ask', microphone: 'ask' })).toBe(false)
  })

  it('定位权限按每应用配置，默认拒绝', () => {
    expect(decidePermissionRequest('geolocation', mediaAllow)).toBe(true)
    expect(decidePermissionRequest('geolocation', mediaDeny)).toBe(false)
    expect(decidePermissionRequest('geolocation')).toBe(false)
  })

  it('未知权限一律拒绝', () => {
    expect(decidePermissionRequest('fullscreen')).toBe(false)
    expect(decidePermissionRequest('pointerLock')).toBe(false)
    expect(decidePermissionRequest('midi')).toBe(false)
    expect(decidePermissionRequest('')).toBe(false)
  })
})
