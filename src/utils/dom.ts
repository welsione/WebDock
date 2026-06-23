// ===== 安全 DOM 查询工具 =====
// 替代裸 `as` 断言，缺失元素时抛错或显式 null 处理

/**
 * 安全获取 DOM 元素，不存在时返回 null
 * 用法：const el = byIdOrNull<HTMLButtonElement>('myBtn')
 */
export function byIdOrNull<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

/**
 * 安全获取 DOM 元素，不存在时抛错
 * 用法：const el = byId<HTMLButtonElement>('myBtn')
 */
export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Element #${id} not found`)
  return el as T
}
