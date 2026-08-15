import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import type * as NotifyStore from '../electron/notification-store'

let testDir: string

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => testDir }
}))

async function loadStore(): Promise<typeof NotifyStore> {
  vi.resetModules()
  return await import('../electron/notification-store')
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `webdock-notify-test-${crypto.randomUUID()}`)
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('sanitizeNotifyPayload', () => {
  it('合法 payload 截断超长 title/body，来源用内嵌 key', async () => {
    const { sanitizeNotifyPayload } = await loadStore()
    const result = sanitizeNotifyPayload(
      { title: 't'.repeat(200), body: 'b'.repeat(600) },
      'deepseek'
    )
    expect(result).toEqual({
      title: 't'.repeat(100),
      body: 'b'.repeat(500),
      appKey: 'deepseek'
    })
  })

  it('页面无法伪造来源：embeddedKey 为空/非法直接丢弃', async () => {
    const { sanitizeNotifyPayload } = await loadStore()
    expect(sanitizeNotifyPayload({ title: 'x', body: '' }, '')).toBeNull()
    expect(sanitizeNotifyPayload({ title: 'x', body: '' }, undefined as never)).toBeNull()
  })

  it('非对象/缺 title/非字符串 title 丢弃', async () => {
    const { sanitizeNotifyPayload } = await loadStore()
    expect(sanitizeNotifyPayload(null, 'k')).toBeNull()
    expect(sanitizeNotifyPayload('str', 'k')).toBeNull()
    expect(sanitizeNotifyPayload({ body: 'x' }, 'k')).toBeNull()
    expect(sanitizeNotifyPayload({ title: 42 }, 'k')).toBeNull()
    expect(sanitizeNotifyPayload({ title: 'ok', body: 42 }, 'k')).toEqual({ title: 'ok', body: '', appKey: 'k' })
  })
})

describe('NotificationStore - 入列/持久化', () => {
  it('add 入列并持久化，list 返回副本', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    const item = await store.add({ title: '新消息', body: '内容' }, 'deepseek')
    expect(item).not.toBeNull()
    expect(item!.appKey).toBe('deepseek')
    expect(store.list()).toHaveLength(1)
    // 持久化完成
    await new Promise(r => setTimeout(r, 50))
    const raw = JSON.parse(fs.readFileSync(path.join(testDir, 'notifications.json'), 'utf-8'))
    expect(raw).toHaveLength(1)
    expect(raw[0].title).toBe('新消息')
  })

  it('环形缓冲：超上限截断，最新在前', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'), 3)
    await store.load()
    for (let i = 0; i < 5; i++) {
      await store.add({ title: `msg${i}` }, 'a')
    }
    const list = store.list()
    expect(list).toHaveLength(3)
    expect(list[0].title).toBe('msg4')
    expect(list[2].title).toBe('msg2')
  })

  it('损坏文件备份为 .bak.json 并继续可用', async () => {
    fs.writeFileSync(path.join(testDir, 'notifications.json'), '{broken')
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    expect(store.list()).toEqual([])
    expect(fs.existsSync(path.join(testDir, 'notifications.json.bak.json'))).toBe(true)
  })

  it('load 过滤非法条目', async () => {
    fs.writeFileSync(path.join(testDir, 'notifications.json'), JSON.stringify([
      { id: '1', appKey: 'a', title: 't', body: '', time: 1, read: false, kind: 'notification' },
      { junk: true },
      null
    ]))
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    expect(store.list()).toHaveLength(1)
  })
})

describe('NotificationStore - 去重与限频', () => {
  it('相邻同 (app,title,body) 合并刷新时间戳与未读', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    const first = await store.add({ title: '同一条', body: 'b' }, 'a')
    const merged = await store.add({ title: '同一条', body: 'b' }, 'a')
    expect(merged!.id).toBe(first!.id)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].read).toBe(false)
  })

  it('不同 app 同内容不合并', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    await store.add({ title: '同一条', body: 'b' }, 'a')
    await store.add({ title: '同一条', body: 'b' }, 'b')
    expect(store.list()).toHaveLength(2)
  })

  it('限频：同 app 60s 内超过 10 条被丢弃', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    let accepted = 0
    for (let i = 0; i < 12; i++) {
      const item = await store.add({ title: `m${i}` }, 'a')
      if (item) accepted++
    }
    expect(accepted).toBe(10)
    expect(store.list()).toHaveLength(10)
  })

  it('标题通知走独立限频（2 条/分钟）', async () => {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    let accepted = 0
    for (let i = 0; i < 4; i++) {
      const item = await store.addTitle('a', `标题${i}`)
      if (item) accepted++
    }
    expect(accepted).toBe(2)
    expect(store.list().every(i => i.kind === 'title')).toBe(true)
  })
})

describe('NotificationStore - 已读/清空/未读', () => {
  async function seed(): Promise<{ store: InstanceType<typeof NotifyStore.NotificationStore> }> {
    const { NotificationStore } = await loadStore()
    const store = new NotificationStore(path.join(testDir, 'notifications.json'))
    await store.load()
    await store.add({ title: 'a1' }, 'a')
    await store.add({ title: 'b1' }, 'b')
    return { store }
  }

  it('markRead 支持 all/app/id', async () => {
    const { store } = await seed()
    await store.markRead({ app: 'a' })
    expect(store.unreadCount()).toBe(1)
    await store.markRead({ all: true })
    expect(store.unreadCount()).toBe(0)
  })

  it('clear 支持 app/all，清空后去重状态同步清除', async () => {
    const { store } = await seed()
    await store.clear({ app: 'a' })
    expect(store.list().map(i => i.appKey)).toEqual(['b'])
    await store.clear({ all: true })
    expect(store.list()).toEqual([])
    // 清空后可重新入列同内容（去重桶已清）
    const item = await store.add({ title: 'a1' }, 'a')
    expect(item).not.toBeNull()
  })

  it('unreadByApp 分组计数', async () => {
    const { store } = await seed()
    await store.add({ title: 'a2' }, 'a')
    expect([...store.unreadByApp().entries()]).toEqual([['a', 2], ['b', 1]])
  })

  it('clearAllSync 同步落盘（退出场景）', async () => {
    const { store } = await seed()
    store.clearAllSync()
    expect(store.list()).toEqual([])
    const raw = JSON.parse(fs.readFileSync(path.join(testDir, 'notifications.json'), 'utf-8'))
    expect(raw).toEqual([])
  })
})

describe('TitleTracker - 标题通知去抖', () => {
  it('防抖窗口内合并多次标题变化，最终触发一次最新标题', async () => {
    vi.useFakeTimers()
    const { TitleTracker } = await loadStore()
    const flushed: Array<[string, string]> = []
    const tracker = new TitleTracker('app1', 2000, (k, t) => flushed.push([k, t]))
    tracker.update('第一版')
    tracker.update('第二版')
    tracker.update('最终版')
    vi.advanceTimersByTime(2000)
    expect(flushed).toEqual([['app1', '最终版']])
    tracker.dispose()
  })

  it('窗口结束后新变化重新计时', async () => {
    vi.useFakeTimers()
    const { TitleTracker } = await loadStore()
    const flushed: string[] = []
    const tracker = new TitleTracker('app1', 1000, (_k, t) => flushed.push(t))
    tracker.update('A')
    vi.advanceTimersByTime(1000)
    tracker.update('B')
    vi.advanceTimersByTime(1000)
    expect(flushed).toEqual(['A', 'B'])
    tracker.dispose()
  })

  it('flush 立即触发，dispose 丢弃', async () => {
    vi.useFakeTimers()
    const { TitleTracker } = await loadStore()
    const flushed: string[] = []
    const tracker = new TitleTracker('app1', 1000, (_k, t) => flushed.push(t))
    tracker.update('X')
    tracker.flush()
    expect(flushed).toEqual(['X'])
    tracker.update('Y')
    tracker.dispose()
    vi.advanceTimersByTime(2000)
    expect(flushed).toEqual(['X'])
  })
})
