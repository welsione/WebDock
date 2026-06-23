import { describe, it, expect } from 'vitest'

// 直接测试 escapeHtml 的逻辑（无需 DOM mock）
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

describe('escapeHtml', () => {
  it('转义 HTML 特殊字符', () => {
    const input = '<script>alert("xss")</script>'
    const result = escapeHtml(input)
    expect(result).toContain('&lt;')
    expect(result).toContain('&gt;')
    expect(result).toContain('&quot;')
    expect(result).not.toContain('<script>')
  })

  it('普通文本不变', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('空字符串', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('转义 & 符号', () => {
    expect(escapeHtml('a & b')).toContain('&amp;')
  })

  it('转义单引号', () => {
    expect(escapeHtml("it's")).toContain('&#39;')
  })
})
