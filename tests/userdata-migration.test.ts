import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import type * as UdMigration from '../electron/userdata-migration'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp/mock-userdata' }
}))

async function loadMigration(): Promise<typeof UdMigration> {
  vi.resetModules()
  return await import('../electron/userdata-migration')
}

let testDir: string
let fromDir: string
let toDir: string

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `webdock-ud-test-${crypto.randomUUID()}`)
  fromDir = path.join(testDir, 'from')
  toDir = path.join(testDir, 'to')
  fs.mkdirSync(fromDir, { recursive: true })
  fs.mkdirSync(toDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('planUserDataMigration - 纯函数规划', () => {
  it('新目录已有 settings.json → 不迁移', async () => {
    const { planUserDataMigration } = await loadMigration()
    const plan = planUserDataMigration(fromDir, toDir, ['settings.json', 'Cookies'], true)
    expect(plan.needsMigration).toBe(false)
  })

  it('旧目录无 settings.json → 不迁移', async () => {
    const { planUserDataMigration } = await loadMigration()
    const plan = planUserDataMigration(fromDir, toDir, ['Cookies'], false)
    expect(plan.needsMigration).toBe(false)
  })

  it('旧目录有 settings.json 且新目录没有 → 迁移，关键项与数据目录分离', async () => {
    const { planUserDataMigration } = await loadMigration()
    const plan = planUserDataMigration(
      fromDir, toDir,
      ['settings.json', 'settings.bak.json', 'notify-icons', 'Cookies', 'Local Storage', 'SomeOther'],
      false
    )
    expect(plan.needsMigration).toBe(true)
    expect(plan.criticalItems).toEqual(['settings.json', 'settings.bak.json', 'notify-icons'])
    // 保持 DATA_DIRS 声明顺序
    expect(plan.dataDirs).toEqual(['Local Storage', 'Cookies'])
  })
})

describe('migrateUserData - 实际搬迁', () => {
  it('复制关键文件与数据目录，不删除旧目录', async () => {
    const { planUserDataMigration, migrateUserData } = await loadMigration()
    fs.writeFileSync(path.join(fromDir, 'settings.json'), '{"v":2}')
    fs.mkdirSync(path.join(fromDir, 'notify-icons'), { recursive: true })
    fs.writeFileSync(path.join(fromDir, 'notify-icons', 'a.png'), 'png')
    fs.mkdirSync(path.join(fromDir, 'Local Storage'), { recursive: true })
    fs.writeFileSync(path.join(fromDir, 'Local Storage', 'leveldb'), 'data')

    const plan = planUserDataMigration(fromDir, toDir, fs.readdirSync(fromDir), false)
    expect(plan.needsMigration).toBe(true)
    const result = await migrateUserData(plan)

    expect(result.ok).toBe(true)
    expect(result.moved).toContain('settings.json')
    expect(fs.readFileSync(path.join(toDir, 'settings.json'), 'utf-8')).toBe('{"v":2}')
    expect(fs.readFileSync(path.join(toDir, 'notify-icons', 'a.png'), 'utf-8')).toBe('png')
    // 数据目录后台复制（等一拍）
    await new Promise(r => setTimeout(r, 100))
    expect(fs.readFileSync(path.join(toDir, 'Local Storage', 'leveldb'), 'utf-8')).toBe('data')
    // 旧目录保留
    expect(fs.existsSync(path.join(fromDir, 'settings.json'))).toBe(true)
  })

  it('无需迁移时直接成功空结果', async () => {
    const { planUserDataMigration, migrateUserData } = await loadMigration()
    const plan = planUserDataMigration(fromDir, toDir, [], false)
    const result = await migrateUserData(plan)
    expect(result).toEqual({ ok: true, moved: [], errors: [] })
  })

  it('单个条目复制失败不影响其他条目（收集 errors）', async () => {
    const { planUserDataMigration, migrateUserData } = await loadMigration()
    fs.writeFileSync(path.join(fromDir, 'settings.json'), '{"v":2}')
    fs.writeFileSync(path.join(fromDir, 'settings.bak.json'), '{"v":1}')
    // 目标目录只读：写入失败（非 root 场景生效）
    fs.chmodSync(toDir, 0o555)
    try {
      const plan = planUserDataMigration(fromDir, toDir, ['settings.json', 'settings.bak.json'], false)
      const result = await migrateUserData(plan)
      expect(result.ok).toBe(false)
      expect(result.moved).toEqual([])
      expect(result.errors.sort()).toEqual(['settings.bak.json', 'settings.json'])
    } finally {
      fs.chmodSync(toDir, 0o755)
    }
  })
})

describe('buildMigrationPlan - 入口', () => {
  it('旧目录不存在 → 无需迁移', async () => {
    const { buildMigrationPlan } = await loadMigration()
    const plan = buildMigrationPlan(path.join(testDir, 'nonexistent-appdata'), toDir)
    expect(plan.needsMigration).toBe(false)
  })

  it('旧目录存在且有 settings.json → 需要迁移', async () => {
    const { buildMigrationPlan } = await loadMigration()
    const appData = path.join(testDir, 'appdata')
    const oldUserData = path.join(appData, 'MineAI Hub')
    fs.mkdirSync(oldUserData, { recursive: true })
    fs.writeFileSync(path.join(oldUserData, 'settings.json'), '{}')
    const plan = buildMigrationPlan(appData, toDir)
    expect(plan.needsMigration).toBe(true)
    expect(plan.fromDir).toBe(oldUserData)
  })
})
