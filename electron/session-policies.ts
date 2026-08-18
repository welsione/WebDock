// ===== 会话权限决策（纯函数，可单测） =====
// 集中管理 BrowserView 的 Chromium 权限请求判定。
// - notifications：WebDock 通知桥接管，始终放行（bridge-preload 转发，来源由主进程反查）
// - clipboard-sanitized-write / clipboard-write：网页内的"复制"按钮依赖
//   navigator.clipboard.writeText 异步剪贴板 API，标准浏览器在用户手势下自动授予；
//   这里放行以恢复网页自身的复制功能（仅允许写入清洗后的纯文本，不涉及读取）
// - media / geolocation：按每应用配置，默认拒绝
// - 其余权限一律拒绝

export interface SessionPermissionConfig {
  camera?: 'allow' | 'ask' | 'deny'
  microphone?: 'allow' | 'ask' | 'deny'
  geolocation?: 'allow' | 'ask' | 'deny'
}

export function decidePermissionRequest(permission: string, perms?: SessionPermissionConfig): boolean {
  if (permission === 'notifications') return true
  // 旧版 Chromium 权限名兼容
  if (permission === 'clipboard-sanitized-write' || permission === 'clipboard-write') return true
  if (permission === 'media') {
    return perms?.camera === 'allow' || perms?.microphone === 'allow'
  }
  if (permission === 'geolocation') {
    return perms?.geolocation === 'allow'
  }
  return false
}
