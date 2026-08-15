/**
 * HTML 特殊字符转义工具函数
 * 用于在 innerHTML 插值时防止 XSS 注入
 * 双引号与单引号都转义，保证在属性上下文（如 src="..."）同样安全
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
