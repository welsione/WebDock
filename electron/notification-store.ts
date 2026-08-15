// ===== 通知收件箱存储模块 =====
// 环形缓冲 + 持久化 + 去重 + 限频 + 未读计数。
// 纯逻辑（清洗/去重/限频/入列）为类内方法，构造参数注入文件路径，便于单测。

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import {
  NOTIFY_MAX_HISTORY,
  NOTIFY_TITLE_MAX,
  NOTIFY_BODY_MAX,
  NOTIFY_RATE_PER_MIN,
  TITLE_NOTIFY_RATE_PER_MIN
} from './config'

// ===== 纯函数：不可信内容清洗 =====
/**
 * 清洗桥接 payload。来源 appKey 用注入时内嵌的 KEY（页面不可伪造）；
 * title/body 截断；非法结构返回 null（丢弃）。
 */
export function sanitizeNotifyPayload(raw: unknown, embeddedKey: string): { title: string; body: string; appKey: string } | null {
  if (!embeddedKey || typeof embeddedKey !== 'string' || embeddedKey.length === 0) return null
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.title !== 'string' || o.title.length === 0) return null
  const title = o.title.slice(0, NOTIFY_TITLE_MAX)
  const body = typeof o.body === 'string' ? o.body.slice(0, NOTIFY_BODY_MAX) : ''
  return { title, body, appKey: embeddedKey }
}

/** 去重哈希：(appKey, title, body) */
export function dedupHash(appKey: string, title: string, body: string): string {
  return crypto.createHash('sha1').update(`${appKey}\u0000${title}\u0000${body}`).digest('hex')
}

/** 环形缓冲入列（最新在前，超上限截断） */
export function appendNotification(items: NotificationItem[], item: NotificationItem, maxHistory: number): NotificationItem[] {
  return [item, ...items].slice(0, maxHistory)
}

/** 标记已读（all / app / id） */
export function markRead(items: NotificationItem[], scope: NotificationReadScope): NotificationItem[] {
  if (scope.all) return items.map(i => (i.read ? i : { ...i, read: true }))
  if (scope.app) return items.map(i => (i.appKey === scope.app && !i.read ? { ...i, read: true } : i))
  if (scope.id) return items.map(i => (i.id === scope.id && !i.read ? { ...i, read: true } : i))
  return items
}

/** 清空（all / app） */
export function clearItems(items: NotificationItem[], scope: NotificationReadScope): NotificationItem[] {
  if (scope.all) return []
  if (scope.app) return items.filter(i => i.appKey !== scope.app)
  return items
}

export function unreadCount(items: NotificationItem[]): number {
  return items.filter(i => !i.read).length
}

/** 每应用未读数 */
export function unreadByApp(items: NotificationItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of items) {
    if (!i.read) m.set(i.appKey, (m.get(i.appKey) ?? 0) + 1)
  }
  return m
}

/** 限频判定：最近 windowMs 内次数 < perMin 则放行并记录 */
export function shouldRateLimit(bucket: number[] | undefined, now: number, windowMs: number, limit: number): { allowed: boolean; bucket: number[] } {
  const current = (bucket ?? []).filter(t => now - t < windowMs)
  if (current.length >= limit) return { allowed: false, bucket: current }
  return { allowed: true, bucket: [...current, now] }
}

// ===== 标题通知去抖（每应用一个实例） =====
export class TitleTracker {
  private pendingTitle: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly appKey: string,
    private readonly debounceMs: number,
    private readonly onFlush: (appKey: string, title: string) => void
  ) {}

  /** 防抖窗口内合并标题；窗口结束触发 onFlush(appKey, 最新标题) */
  update(title: string): void {
    if (!title) return
    if (this.pendingTitle !== null) {
      this.pendingTitle = title
      return
    }
    this.pendingTitle = title
    this.timer = setTimeout(() => {
      const t = this.pendingTitle
      this.pendingTitle = null
      this.timer = null
      if (t) this.onFlush(this.appKey, t)
    }, this.debounceMs)
  }

  /** 立即触发（测试/退出用） */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const t = this.pendingTitle
    this.pendingTitle = null
    if (t) this.onFlush(this.appKey, t)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pendingTitle = null
  }
}

// ===== 存储 =====
export class NotificationStore {
  private items: NotificationItem[] = []
  private rateBuckets = new Map<string, number[]>()
  private dedup = new Map<string, { hash: string; time: number }>()
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    private readonly filePath: string,
    private readonly maxHistory: number = NOTIFY_MAX_HISTORY
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      await fs.promises.access(this.filePath)
      const content = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        this.items = parsed
          .filter((i): i is NotificationItem => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.appKey === 'string')
          .slice(0, this.maxHistory)
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('Failed to load notifications:', e)
        try {
          await fs.promises.rename(this.filePath, `${this.filePath}.bak.json`)
        } catch {
          // 忽略备份失败
        }
      }
    }
  }

  private persist(): Promise<{ ok: boolean; error?: string }> {
    const result = this.writeQueue
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
        await fs.promises.writeFile(this.filePath, JSON.stringify(this.items))
        return { ok: true as const }
      })
      .catch((e: unknown) => {
        log.error('Failed to save notifications:', e)
        return { ok: false as const, error: (e as Error).message }
      })
    this.writeQueue = result.then(() => undefined)
    return result
  }

  /** 同步持久化（退出场景：clearNotificationsOnQuit 时来不及 await 串行队列） */
  persistSync(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.items))
    } catch (e) {
      log.error('Failed to sync-save notifications:', e)
    }
  }

  /**
   * 入列一条桥接通知：清洗 → 限频 → 去重合并 → 环形缓冲 → 持久化。
   * 返回入列条目（null = 被丢弃）。
   */
  async add(raw: unknown, embeddedKey: string): Promise<NotificationItem | null> {
    const payload = sanitizeNotifyPayload(raw, embeddedKey)
    if (!payload) return null
    return this.addInternal(payload.appKey, payload.title, payload.body, 'notification', NOTIFY_RATE_PER_MIN)
  }

  /** 入列标题通知（走独立限频） */
  async addTitle(appKey: string, title: string): Promise<NotificationItem | null> {
    if (!appKey || !title) return null
    return this.addInternal(appKey, title.slice(0, NOTIFY_TITLE_MAX), '', 'title', TITLE_NOTIFY_RATE_PER_MIN)
  }

  private async addInternal(
    appKey: string,
    title: string,
    body: string,
    kind: 'notification' | 'title',
    rateLimit: number
  ): Promise<NotificationItem | null> {
    const now = Date.now()
    // 限频（60s 窗口）
    const bucket = this.rateBuckets.get(appKey)
    const rate = shouldRateLimit(bucket, now, 60_000, rateLimit)
    this.rateBuckets.set(appKey, rate.bucket)
    if (!rate.allowed) return null

    // 去重：该 app 最近一条同 hash → 合并刷新（更新 time、重置未读）
    const hash = dedupHash(appKey, title, body)
    const appLastIndex = this.items.findIndex(i => i.appKey === appKey)
    if (appLastIndex >= 0 && this.dedup.get(appKey)?.hash === hash) {
      const merged: NotificationItem = { ...this.items[appLastIndex], time: now, read: false }
      this.items[appLastIndex] = merged
      void this.persist()
      return merged
    }
    this.dedup.set(appKey, { hash, time: now })

    const item: NotificationItem = {
      id: crypto.randomUUID(),
      appKey,
      title,
      body,
      time: now,
      read: false,
      kind
    }
    this.items = appendNotification(this.items, item, this.maxHistory)
    void this.persist()
    return item
  }

  list(): NotificationItem[] {
    return [...this.items]
  }

  async markRead(scope: NotificationReadScope): Promise<void> {
    this.items = markRead(this.items, scope)
    void this.persist()
  }

  async clear(scope: NotificationReadScope): Promise<void> {
    this.items = clearItems(this.items, scope)
    if (scope.app) this.dedup.delete(scope.app)
    if (scope.all) this.dedup.clear()
    void this.persist()
  }

  async clearForApp(appKey: string): Promise<void> {
    this.items = clearItems(this.items, { app: appKey })
    this.dedup.delete(appKey)
    this.rateBuckets.delete(appKey)
    void this.persist()
  }

  unreadCount(): number {
    return unreadCount(this.items)
  }

  unreadByApp(): Map<string, number> {
    return unreadByApp(this.items)
  }

  /** 退出时清空（同步落盘） */
  clearAllSync(): void {
    this.items = []
    this.dedup.clear()
    this.persistSync()
  }
}
