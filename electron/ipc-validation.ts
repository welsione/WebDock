// ===== IPC 输入校验 =====
// IPC 数据来自渲染进程，不可信：恶意或异常 payload 不得让主进程崩溃。
// 所有校验函数为纯函数（可单测），handler 层统一接入。

export interface ValidatedWebApp {
  key: string
  name: string
  url: string
  icon?: string | null
  color?: WebAppColor
  notify?: WebAppNotify
  permissions?: WebAppPermissions
  trustCertificate?: boolean
  launch?: WebAppLaunch
  preset?: boolean
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

const PERMISSION_VALUES = new Set(['allow', 'ask', 'deny'])

function sanitizePermissions(v: unknown): WebAppPermissions | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const camera = o.camera
  const microphone = o.microphone
  const geolocation = o.geolocation
  if (!PERMISSION_VALUES.has(camera as string) && camera !== undefined) return undefined
  if (!PERMISSION_VALUES.has(microphone as string) && microphone !== undefined) return undefined
  if (!PERMISSION_VALUES.has(geolocation as string) && geolocation !== undefined) return undefined
  const result: WebAppPermissions = {
    camera: (camera as WebAppPermissions['camera']) ?? 'deny',
    microphone: (microphone as WebAppPermissions['microphone']) ?? 'deny',
    geolocation: (geolocation as WebAppPermissions['geolocation']) ?? 'deny'
  }
  // 全部为默认 deny 时视为未设置，丢弃冗余字段
  if (result.camera === 'deny' && result.microphone === 'deny' && result.geolocation === 'deny') return undefined
  return result
}

function sanitizeNotify(v: unknown): WebAppNotify | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.native !== 'boolean' && o.native !== undefined) return undefined
  if (typeof o.titleNotify !== 'boolean' && o.titleNotify !== undefined) return undefined
  const result: WebAppNotify = {
    native: typeof o.native === 'boolean' ? o.native : true,
    titleNotify: typeof o.titleNotify === 'boolean' ? o.titleNotify : false
  }
  // 全默认时丢弃
  if (result.native === true && result.titleNotify === false) return undefined
  return result
}

/** launch：command 必须非空字符串；healthUrl 必须是 http/https 可解析；cwd/exitWithApp 可选 */
export function sanitizeLaunch(v: unknown): WebAppLaunch | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.command)) return undefined
  const result: WebAppLaunch = { command: o.command }
  if (typeof o.cwd === 'string' && o.cwd.length > 0) result.cwd = o.cwd
  if (typeof o.exitWithApp === 'boolean') result.exitWithApp = o.exitWithApp
  if (typeof o.healthUrl === 'string' && o.healthUrl.length > 0) {
    try {
      const parsed = new URL(o.healthUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        result.healthUrl = o.healthUrl
      }
    } catch {
      // 非法 healthUrl 丢弃（回退默认 = url）
    }
  }
  return result
}

/** webApp：key/name/url 非空字符串；其余字段逐项清洗 */
export function sanitizeWebApp(v: unknown): ValidatedWebApp | undefined {
  if (!v || typeof v !== 'object') return undefined
  const p = v as Record<string, unknown>
  if (!isNonEmptyString(p.key) || !isNonEmptyString(p.name) || !isNonEmptyString(p.url)) return undefined
  const app: ValidatedWebApp = {
    key: p.key,
    name: p.name,
    url: p.url
  }
  if (typeof p.icon === 'string' && p.icon.length > 0) app.icon = p.icon
  const color = sanitizeColor(p.color)
  if (color) app.color = color
  const notify = sanitizeNotify(p.notify)
  if (notify) app.notify = notify
  const permissions = sanitizePermissions(p.permissions)
  if (permissions) app.permissions = permissions
  if (typeof p.trustCertificate === 'boolean') app.trustCertificate = p.trustCertificate
  const launch = sanitizeLaunch(p.launch)
  if (launch) app.launch = launch
  if (typeof p.preset === 'boolean') app.preset = p.preset
  return app
}

/** appSettings：各字段严格类型校验，非法项回退默认 */
export function sanitizeAppSettings(v: unknown, defaults: AppSettings): AppSettings {
  if (!v || typeof v !== 'object') return { ...defaults }
  const o = v as Record<string, unknown>
  return {
    notifyDefaultNative: typeof o.notifyDefaultNative === 'boolean' ? o.notifyDefaultNative : defaults.notifyDefaultNative,
    audioExclusive: typeof o.audioExclusive === 'boolean' ? o.audioExclusive : defaults.audioExclusive,
    viewCacheLimit: typeof o.viewCacheLimit === 'number' && Number.isFinite(o.viewCacheLimit) && o.viewCacheLimit >= 0
      ? Math.floor(o.viewCacheLimit)
      : defaults.viewCacheLimit,
    clearNotificationsOnQuit: typeof o.clearNotificationsOnQuit === 'boolean' ? o.clearNotificationsOnQuit : defaults.clearNotificationsOnQuit
  }
}

/** enabled：必须是 string 数组，否则回退 null（全部启用） */
export function sanitizeEnabled(v: unknown): string[] | null {
  return isStringArray(v) ? v : null
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

/** webApp key：必须非空字符串 */
export function sanitizeWebAppKey(v: unknown): string | null {
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
