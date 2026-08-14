// ===== IPC 输入校验 =====
// IPC 数据来自渲染进程，不可信：恶意或异常 payload 不得让主进程崩溃。
// 所有校验函数为纯函数（可单测），handler 层统一接入。

export interface ValidatedCustomProvider {
  key: string
  name: string
  url: string
  icon?: string
  color?: { dark: string; light: string }
}

export interface ValidatedColor {
  dark: string
  light: string
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

function sanitizeColor(v: unknown): ValidatedColor | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.dark === 'string' && typeof o.light === 'string') {
    return { dark: o.dark, light: o.light }
  }
  return undefined
}

/** enabled：必须是 string 数组，否则回退 null（全部启用） */
export function sanitizeEnabled(v: unknown): string[] | null {
  return isStringArray(v) ? v : null
}

/** custom：必须是数组，逐项过滤非法项（key/name/url 非空字符串，其余字段可选） */
export function sanitizeCustomProviders(v: unknown): ValidatedCustomProvider[] {
  if (!Array.isArray(v)) return []
  const result: ValidatedCustomProvider[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    if (!isNonEmptyString(p.key) || !isNonEmptyString(p.name) || !isNonEmptyString(p.url)) continue
    const provider: ValidatedCustomProvider = {
      key: p.key,
      name: p.name,
      url: p.url
    }
    if (typeof p.icon === 'string' && p.icon.length > 0) provider.icon = p.icon
    const color = sanitizeColor(p.color)
    if (color) provider.color = color
    result.push(provider)
  }
  return result
}

/** order：必须是 string 数组，否则回退空数组 */
export function sanitizeOrder(v: unknown): string[] {
  return isStringArray(v) ? v : []
}

/** builtInColors：对象且每项为 {dark, light} 字符串，非法项丢弃 */
export function sanitizeBuiltInColors(v: unknown): Record<string, ValidatedColor> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const result: Record<string, ValidatedColor> = {}
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    const color = sanitizeColor(value)
    if (color) result[key] = color
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** theme：THEME_SCRIPTS 仅含 dark/light，白名单外一律拒绝（防止 executeJavaScript(undefined)） */
export function sanitizeTheme(v: unknown): 'dark' | 'light' | null {
  return v === 'dark' || v === 'light' ? v : null
}

/** provider key：必须非空字符串 */
export function sanitizeProviderKey(v: unknown): string | null {
  return isNonEmptyString(v) ? v : null
}

/** 布尔：必须严格 boolean */
export function sanitizeBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/** 数字：必须有限数值 */
export function sanitizeNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
