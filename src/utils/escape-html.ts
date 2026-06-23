/**
 * HTML 特殊字符转义工具函数
 * 用于在 innerHTML 插值时防止 XSS 注入
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML.replace(/"/g, '&quot;')
}
