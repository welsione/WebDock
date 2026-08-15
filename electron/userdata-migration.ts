// ===== userData 目录搬迁（MineAI Hub → WebDock） =====
// 打包后 app.getName() 返回 productName，userData 路径从
// `~/Library/Application Support/MineAI Hub` 变为 `.../WebDock`。
// 启动早期检测旧目录有数据而新目录没有 → 自动复制搬迁（旧目录保留不删，安全）。
// 规划逻辑为纯函数（可单测），fs 操作为异步。

import path from 'path'
import fs from 'fs'
import log from 'electron-log'

/** 关键文件/目录（先同步复制，保证设置与会话尽快可用） */
const CRITICAL_ITEMS = ['settings.json', 'settings.bak.json', 'notify-icons']

/** 会话数据目录（后台异步复制，失败可接受——最坏情况用户重新登录） */
const DATA_DIRS = [
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Cookies',
  'Cookies-journal',
  'blob_storage',
  'GPUCache',
  'Network Persistent State',
  'Preferences'
]

export interface UserDataMigrationPlan {
  fromDir: string
  toDir: string
  needsMigration: boolean
  /** 需要复制的关键条目（fromDir 下实际存在的） */
  criticalItems: string[]
  /** 需要后台复制的数据目录（fromDir 下实际存在的） */
  dataDirs: string[]
}

/**
 * 纯函数规划：仅在"新目录无 settings.json 且旧目录有"时搬迁。
 * @param fromEntries 旧目录下的实际条目（readdir 结果）
 * @param toHasSettings 新目录是否已有 settings.json
 */
export function planUserDataMigration(
  fromDir: string,
  toDir: string,
  fromEntries: string[],
  toHasSettings: boolean
): UserDataMigrationPlan {
  const entrySet = new Set(fromEntries)
  const fromHasSettings = entrySet.has('settings.json')
  return {
    fromDir,
    toDir,
    needsMigration: !toHasSettings && fromHasSettings,
    criticalItems: CRITICAL_ITEMS.filter(i => entrySet.has(i)),
    dataDirs: DATA_DIRS.filter(d => entrySet.has(d))
  }
}

async function copyItem(src: string, dest: string): Promise<void> {
  await fs.promises.cp(src, dest, { recursive: true, force: true })
}

/** 复制单个条目（条目不存在视为成功——可能已被并发删除） */
async function tryCopyItem(fromDir: string, toDir: string, item: string): Promise<{ item: string; ok: boolean }> {
  const src = path.join(fromDir, item)
  const dest = path.join(toDir, item)
  try {
    await fs.promises.access(src)
  } catch {
    return { item, ok: true }
  }
  try {
    await copyItem(src, dest)
    return { item, ok: true }
  } catch (e) {
    log.error(`Failed to migrate userData item "${item}":`, e)
    return { item, ok: false }
  }
}

/**
 * 执行搬迁。criticalItems 同步复制并 await；dataDirs 后台复制（不阻塞启动）。
 */
export async function migrateUserData(
  plan: UserDataMigrationPlan
): Promise<{ ok: boolean; moved: string[]; errors: string[] }> {
  if (!plan.needsMigration) return { ok: true, moved: [], errors: [] }
  const moved: string[] = []
  const errors: string[] = []

  // 关键条目：同步复制
  for (const item of plan.criticalItems) {
    const r = await tryCopyItem(plan.fromDir, plan.toDir, item)
    if (r.ok) moved.push(item)
    else errors.push(item)
  }

  // 数据目录：后台复制，不阻塞启动
  for (const dir of plan.dataDirs) {
    void tryCopyItem(plan.fromDir, plan.toDir, dir).then(r => {
      if (r.ok) moved.push(dir)
      else errors.push(dir)
    })
  }

  if (moved.length > 0) {
    log.info(`UserData migrated from ${plan.fromDir} to ${plan.toDir}: ${moved.join(', ')}`)
  }
  return { ok: errors.length === 0, moved, errors }
}

/** 入口：旧目录 = Application Support/MineAI Hub（appData 下） */
export function buildMigrationPlan(appDataDir: string, userDataDir: string): UserDataMigrationPlan {
  const fromDir = path.join(appDataDir, 'MineAI Hub')
  const toDir = userDataDir
  let fromEntries: string[]
  try {
    fromEntries = fs.readdirSync(fromDir)
  } catch {
    // 旧目录不存在：无需迁移
    return { fromDir, toDir, needsMigration: false, criticalItems: [], dataDirs: [] }
  }
  let toHasSettings: boolean
  try {
    toHasSettings = fs.existsSync(path.join(toDir, 'settings.json'))
  } catch {
    toHasSettings = false
  }
  return planUserDataMigration(fromDir, toDir, fromEntries, toHasSettings)
}
