// ===== 导航策略模块 =====
// 主 frame 导航的同源判定：同源（含 SPA history 路由）留在应用内，跨域默认外部打开。
// 纯函数，便于单测。

export interface NavigationDecision {
  /** true = 留在应用内；false = 应外部打开（调用方 preventDefault + shell.openExternal） */
  keepInApp: boolean
  reason: 'same-origin' | 'cross-origin' | 'invalid'
}

/**
 * 判定导航是否应留在应用内。
 * - 任一 URL 解析失败 → invalid（保守：留在应用内，避免误拦）
 * - 协议不同（如 http↔https）视为跨域
 * - 空 url（about:blank 等）留在应用内
 */
export function decideNavigation(currentUrl: string, targetUrl: string): NavigationDecision {
  if (!targetUrl || targetUrl === 'about:blank') {
    return { keepInApp: true, reason: 'same-origin' }
  }
  let cur: URL
  let target: URL
  try {
    cur = new URL(currentUrl)
    target = new URL(targetUrl)
  } catch {
    return { keepInApp: true, reason: 'invalid' }
  }
  const same = cur.origin === target.origin
  return same
    ? { keepInApp: true, reason: 'same-origin' }
    : { keepInApp: false, reason: 'cross-origin' }
}
