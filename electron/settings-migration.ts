// ===== 设置迁移模块 =====
// settings.json v1（MineAI Hub：builtIn/enabled/custom/order 二分模型）→ v2（WebDock：统一 webApps 模型）
// 纯函数，便于单测；IO 由调用方负责

import { SETTINGS_VERSION, DEFAULT_APP_SETTINGS, type Settings, type StoredWebApp } from './settings-store'

export interface MigrationResult {
  settings: Settings
  changed: boolean
}

/**
 * 迁移设置到当前版本。
 * - raw 为 null（无设置文件）→ 返回空 v2 设置（webApps 由调用方按首启逻辑填充）
 * - 已是 v2 → 原样返回
 * - v1（无 settingsVersion 且存在旧字段）→ 合并为 v2：
 *   内置项由 presets 重建（应用 builtInColors、按 providerOrder 排序、剔除 enabledProviders 中禁用的），
 *   自定义项原样带入；其他字段（shortcut/switchShortcut/windowBounds/mode）保留。
 */
export function migrateSettings(raw: Settings | null, presets: WebAppInfo[]): MigrationResult {
  if (!raw) {
    return {
      settings: { settingsVersion: SETTINGS_VERSION, appSettings: { ...DEFAULT_APP_SETTINGS } },
      changed: false
    }
  }
  if (raw.settingsVersion === SETTINGS_VERSION) return { settings: raw, changed: false }

  // v1 判定：无版本号且存在任意旧字段（v1 字段集：enabled/custom/order/colors）
  const hasV1Fields =
    raw.enabledProviders !== undefined ||
    raw.customProviders !== undefined ||
    raw.providerOrder !== undefined ||
    raw.builtInColors !== undefined
  if (!hasV1Fields) {
    // 无版本号也无旧字段：视为新安装（可能是外部写入的残缺文件），补齐版本号
    return {
      settings: { ...raw, settingsVersion: SETTINGS_VERSION, appSettings: { ...DEFAULT_APP_SETTINGS, ...raw.appSettings } },
      changed: true
    }
  }

  const webApps = mergeV1WebApps(raw, presets)
  const migrated: Settings = {
    settingsVersion: SETTINGS_VERSION,
    webApps,
    appSettings: { ...DEFAULT_APP_SETTINGS, ...raw.appSettings },
    shortcut: raw.shortcut,
    switchShortcut: raw.switchShortcut,
    windowBounds: raw.windowBounds,
    mode: raw.mode
  }
  return { settings: migrated, changed: true }
}

/** v1 → v2 核心合并逻辑（纯函数） */
export function mergeV1WebApps(raw: Settings, presets: WebAppInfo[]): StoredWebApp[] {
  const enabled = raw.enabledProviders ?? null
  const order = raw.providerOrder ?? null
  const colors = raw.builtInColors ?? {}

  const builtIn: StoredWebApp[] = presets
    .filter(p => enabled === null || enabled.includes(p.key))
    .map(p => ({
      ...p,
      color: colors[p.key] || p.color,
      icon: p.icon,
      preset: true
    }))

  const custom: StoredWebApp[] = (raw.customProviders ?? []).map(p => ({ ...p }))

  const merged = [...builtIn, ...custom]
  if (!order) return merged
  const orderMap = new Map(order.map((k, i) => [k, i]))
  merged.sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999))
  return merged
}
