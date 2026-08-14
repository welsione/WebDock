import { describe, it, expect, vi, afterEach } from 'vitest'
import { escapeHtml } from '../src/utils/escape-html'

// 模拟浏览器 DOM 语义：textContent 赋值后 innerHTML 返回 < > & 的转义结果
// （escapeHtml 自身的双引号/单引号转义逻辑仍由被测代码真实执行）
function createElementMock(): { textContent: string; innerHTML: string } {
  const el = { _text: '', innerHTML: '' } as {
    _text: string
    innerHTML: string
    textContent: string
  }
  Object.defineProperty(el, 'textContent', {
    set(v: string) {
      el._text = v
      el.innerHTML = v
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    },
    get() {
      return el._text
    }
  })
  return el as unknown as { textContent: string; innerHTML: string }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('escapeHtml', () => {
  it('转义 <script> 注入', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    const input = '<script>alert("xss")</script>'
    const result = escapeHtml(input)
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(result).not.toContain('<script>')
  })

  it('转义 & 符号', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('转义双引号（属性上下文安全）', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('转义单引号（属性上下文安全）', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('普通文本保持不变', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    expect(escapeHtml('hello world 123')).toBe('hello world 123')
  })

  it('空字符串返回空', () => {
    vi.stubGlobal('document', { createElement: () => createElementMock() })
    expect(escapeHtml('')).toBe('')
  })
})
