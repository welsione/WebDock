import { describe, it, expect } from 'vitest'
import { decideNavigation } from '../electron/navigation'

describe('decideNavigation - 同源', () => {
  it('同 origin 留在应用内', () => {
    expect(decideNavigation('https://chat.deepseek.com/a', 'https://chat.deepseek.com/b').keepInApp).toBe(true)
    expect(decideNavigation('https://chat.deepseek.com/', 'https://chat.deepseek.com/thread/123').reason).toBe('same-origin')
  })

  it('about:blank 留在应用内', () => {
    expect(decideNavigation('https://a.com', '').keepInApp).toBe(true)
    expect(decideNavigation('https://a.com', 'about:blank').keepInApp).toBe(true)
  })

  it('URL 解析失败保守留在应用内（避免误拦）', () => {
    expect(decideNavigation('not a url', 'https://a.com').keepInApp).toBe(true)
    expect(decideNavigation('https://a.com', 'not a url').keepInApp).toBe(true)
  })
})

describe('decideNavigation - 跨域', () => {
  it('跨 host 外部打开', () => {
    const d = decideNavigation('https://chat.deepseek.com/', 'https://example.com/')
    expect(d.keepInApp).toBe(false)
    expect(d.reason).toBe('cross-origin')
  })

  it('跨协议（http↔https）视为跨域', () => {
    expect(decideNavigation('http://127.0.0.1:3080/', 'https://127.0.0.1:3080/').keepInApp).toBe(false)
  })

  it('跨端口视为跨域（本地服务场景）', () => {
    expect(decideNavigation('http://127.0.0.1:3080/', 'http://127.0.0.1:8080/').keepInApp).toBe(false)
  })
})
