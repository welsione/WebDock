import { describe, it, expect } from 'vitest'
import { validateProviderUrl, validateIconFile } from '../src/ui/provider-modal'

describe('validateProviderUrl', () => {
  it('接受标准 https 网址', () => {
    expect(validateProviderUrl('https://chat.openai.com')).toBeNull()
  })

  it('接受 http 网址', () => {
    expect(validateProviderUrl('http://example.com')).toBeNull()
  })

  it('接受本地服务地址（127.0.0.1 为核心场景，不可拦截）', () => {
    expect(validateProviderUrl('http://127.0.0.1:11434')).toBeNull()
    expect(validateProviderUrl('http://localhost:8080')).toBeNull()
    expect(validateProviderUrl('http://192.168.1.10:3000')).toBeNull()
  })

  it('接受带路径的网址', () => {
    expect(validateProviderUrl('https://example.com/chat?q=1#top')).toBeNull()
  })

  it('拒绝空值', () => {
    expect(validateProviderUrl('')).toBe('请输入网址')
    expect(validateProviderUrl('   ')).toBe('请输入网址')
  })

  it('拒绝非法 URL', () => {
    expect(validateProviderUrl('not a url')).toBe('网址格式不正确')
  })

  it('拒绝非 http/https 协议', () => {
    expect(validateProviderUrl('ftp://example.com')).toBe('仅支持 http/https 协议')
    expect(validateProviderUrl('file:///etc/passwd')).toBe('仅支持 http/https 协议')
    expect(validateProviderUrl('javascript:alert(1)')).toBe('仅支持 http/https 协议')
  })

  it('拒绝无主机名', () => {
    expect(validateProviderUrl('https://')).toBe('网址格式不正确')
  })
})

describe('validateIconFile', () => {
  function fakeFile(name: string, type: string, size: number): File {
    return { name, type, size } as File
  }

  it('接受 256KB 以内的图片', () => {
    expect(validateIconFile(fakeFile('a.png', 'image/png', 100 * 1024))).toBeNull()
  })

  it('恰好 256KB 通过', () => {
    expect(validateIconFile(fakeFile('a.png', 'image/png', 256 * 1024))).toBeNull()
  })

  it('拒绝超过 256KB 的图片', () => {
    expect(validateIconFile(fakeFile('big.png', 'image/png', 256 * 1024 + 1))).toBe('图片不能超过 256KB')
  })

  it('拒绝非图片类型', () => {
    expect(validateIconFile(fakeFile('evil.exe', 'application/x-msdownload', 100))).toBe('仅支持图片文件')
  })
})
