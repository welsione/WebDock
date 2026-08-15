import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as StateModule from '../src/state'

// 每个测试通过 vi.resetModules() 重新加载 state 模块，避免模块级单例相互污染
async function loadState(): Promise<typeof StateModule> {
  vi.resetModules()
  return await import('../src/state')
}

const dispatchSpy = vi.fn()

const DEFAULT_APP_SETTINGS: AppSettings = {
  notifyDefaultNative: true,
  audioExclusive: true,
  viewCacheLimit: 0,
  clearNotificationsOnQuit: false
}

beforeEach(() => {
  dispatchSpy.mockClear()
  vi.stubGlobal('document', { dispatchEvent: dispatchSpy })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('state - getState 只读视图', () => {
  it('直接 mutate webApps 数组应抛错（深冻结）', async () => {
    const { getState, updateWebApps } = await loadState()
    updateWebApps([{ key: 'a', name: 'A', url: 'https://a.com', icon: 'i', color: { dark: '#000', light: '#fff' } }])
    expect(() => (getState().webApps as unknown[]).push('x')).toThrow()
  })

  it('mutate 返回的 appStatus 副本不影响内部状态', async () => {
    const { getState, setAppStatus } = await loadState()
    setAppStatus('a', 'loading')
    // mutate 快照中的 Map 副本
    getState().appStatus.set('a', 'error')
    expect(getState().appStatus.get('a')).toBe('loading')
  })

  it('直接修改 webAppSettings.webApps 应抛错', async () => {
    const { getState, addWebApp } = await loadState()
    addWebApp({ key: 'c', name: 'C', url: 'https://c.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    expect(() => (getState().webAppSettings.webApps as unknown[]).push('x')).toThrow()
  })

  it('notifications 快照为副本，mutate 抛错且不影响内部状态', async () => {
    const { getState, setNotifications } = await loadState()
    const item: NotificationItem = { id: '1', appKey: 'a', title: 't', body: '', time: 1, read: false, kind: 'notification' }
    setNotifications([item])
    expect(() => (getState().notifications as unknown[]).push({ ...item, id: '2' })).toThrow()
    expect(getState().notifications.length).toBe(1)
  })
})

describe('state - setCurrentWebApp', () => {
  it('更新当前应用并 dispatch webapp-changed', async () => {
    const { getState, setCurrentWebApp } = await loadState()
    setCurrentWebApp('kimi')
    expect(getState().currentWebAppKey).toBe('kimi')
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe('webapp-changed')
    expect(event.detail).toEqual({ key: 'kimi' })
  })
})

describe('state - setAppStatus', () => {
  it('loading/starting/error 记录状态，loaded 移除状态', async () => {
    const { getState, setAppStatus } = await loadState()
    setAppStatus('deepseek', 'loading')
    setAppStatus('kimi', 'starting')
    setAppStatus('zhipu', 'error')
    expect(getState().appStatus.get('deepseek')).toBe('loading')
    expect(getState().appStatus.get('kimi')).toBe('starting')
    expect(getState().appStatus.get('zhipu')).toBe('error')
    setAppStatus('deepseek', 'loaded')
    expect(getState().appStatus.has('deepseek')).toBe(false)
  })
})

describe('state - 网页应用 setter', () => {
  it('addWebApp 追加且不修改原数组', async () => {
    const { getState, addWebApp } = await loadState()
    addWebApp({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    expect(getState().webAppSettings.webApps.length).toBe(1)
    expect(getState().webAppSettings.webApps[0].key).toBe('c1')
  })

  it('removeWebApp 按 key 删除不受顺序影响（拖拽/多次删除后 key 仍稳定）', async () => {
    const { getState, addWebApp, removeWebApp } = await loadState()
    addWebApp({ key: 'a', name: 'A', url: 'https://a.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    addWebApp({ key: 'b', name: 'B', url: 'https://b.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    addWebApp({ key: 'c', name: 'C', url: 'https://c.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    removeWebApp('c')
    expect(getState().webAppSettings.webApps.map(p => p.key)).toEqual(['a', 'b'])
  })

  it('updateWebApp 按 key 更新目标项', async () => {
    const { getState, addWebApp, updateWebApp } = await loadState()
    addWebApp({ key: 'c1', name: 'C1', url: 'https://c1.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    addWebApp({ key: 'c2', name: 'C2', url: 'https://c2.com', icon: 'i', color: { dark: '#000', light: '#fff' } })
    updateWebApp('c2', { name: 'C2 改名', launch: { command: 'dsh web' } })
    const webApps = getState().webAppSettings.webApps
    expect(webApps[0].name).toBe('C1')
    expect(webApps[1].name).toBe('C2 改名')
    expect(webApps[1].launch?.command).toBe('dsh web')
    expect(webApps[1].url).toBe('https://c2.com')
  })

  it('updateAppSettings 合并更新且不丢其他字段', async () => {
    const { getState, updateWebAppSettings, updateAppSettings } = await loadState()
    updateWebAppSettings({ webApps: [], appSettings: { ...DEFAULT_APP_SETTINGS } })
    updateAppSettings({ audioExclusive: false })
    expect(getState().webAppSettings.appSettings.audioExclusive).toBe(false)
    expect(getState().webAppSettings.appSettings.notifyDefaultNative).toBe(true)
  })
})

describe('state - 通知收件箱', () => {
  const item = (id: string, appKey = 'a', read = false): NotificationItem =>
    ({ id, appKey, title: 't', body: '', time: 1, read, kind: 'notification' })

  it('addNotification 新条目在前', async () => {
    const { getState, setNotifications, addNotification } = await loadState()
    setNotifications([item('1')])
    addNotification(item('2'))
    expect(getState().notifications.map(i => i.id)).toEqual(['2', '1'])
  })

  it('markNotificationsRead 支持 all/app/id', async () => {
    const { getState, setNotifications, markNotificationsRead } = await loadState()
    setNotifications([item('1', 'a'), item('2', 'b')])
    markNotificationsRead({ app: 'a' })
    let items = getState().notifications
    expect(items.find(i => i.id === '1')?.read).toBe(true)
    expect(items.find(i => i.id === '2')?.read).toBe(false)
    markNotificationsRead({ id: '2' })
    items = getState().notifications
    expect(items.find(i => i.id === '2')?.read).toBe(true)
    setNotifications([item('3', 'a'), item('4', 'b')])
    markNotificationsRead({ all: true })
    expect(getState().notifications.every(i => i.read)).toBe(true)
  })

  it('clearNotifications 支持 all/app', async () => {
    const { getState, setNotifications, clearNotifications } = await loadState()
    setNotifications([item('1', 'a'), item('2', 'b')])
    clearNotifications({ app: 'a' })
    expect(getState().notifications.map(i => i.id)).toEqual(['2'])
    clearNotifications({ all: true })
    expect(getState().notifications).toEqual([])
  })

  it('unreadCount / unreadByApp', async () => {
    const { getState, setNotifications, unreadCount, unreadByApp } = await loadState()
    setNotifications([item('1', 'a'), item('2', 'a'), item('3', 'b', true)])
    expect(unreadCount()).toBe(2)
    expect([...unreadByApp().entries()]).toEqual([['a', 2]])
    void getState
  })
})
