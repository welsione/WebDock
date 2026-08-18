import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// ===== Icon Loading =====
const iconBaseDir = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '..', '..', 'assets')

function loadIcon(name: string): string {
  try {
    const ext = path.extname(name).toLowerCase()
    const mimeMap: Record<string, string> = { '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg' }
    const mime = mimeMap[ext] || 'image/png'
    return `data:${mime};base64,${fs.readFileSync(path.join(iconBaseDir, name)).toString('base64')}`
  } catch {
    // 图标文件缺失时用首字母 SVG 回退
    const letter = path.basename(name, path.extname(name)).charAt(0).toUpperCase() || '?'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#5eead4"/><text x="24" y="32" text-anchor="middle" font-size="24" font-weight="700" fill="#fff" font-family="-apple-system,sans-serif">${letter}</text></svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }
}

// ===== 预置网页应用（可编辑/删除，与自定义完全同构） =====
const PRESET_WEB_APPS: WebAppInfo[] = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: loadIcon('deepseek.png'), color: { dark: '#151517', light: '#ffffff' }, preset: true },
  { key: 'doubao',   name: '豆包',     url: 'https://www.doubao.com/chat/',  icon: loadIcon('doubao.png'), color: { dark: '#1f1f1f', light: '#f9f9f9' }, preset: true },
  { key: 'kimi',     name: 'Kimi',     url: 'https://kimi.moonshot.cn/',     icon: loadIcon('kimi.png'), color: { dark: '#151616', light: '#ffffff' }, preset: true },
  { key: 'metaso',   name: 'Metaso',   url: 'https://metaso.cn/',            icon: loadIcon('metaso.png'), color: { dark: '#16181e', light: '#fbfbfa' }, preset: true },
  { key: 'qianwen',  name: '千问',     url: 'https://www.qianwen.com/',      icon: loadIcon('qianwen.png'), color: { dark: '#111112', light: '#f7f7f9' }, preset: true },
  { key: 'minimax',  name: 'MiniMax',  url: 'https://agent.minimaxi.com/',   icon: loadIcon('minimax.png'), color: { dark: '#171717', light: '#ffffff' }, preset: true },
  { key: 'zhipu',    name: '智谱',     url: 'https://chat.z.ai/',            icon: loadIcon('zhipu.png'), color: { dark: '#161616', light: '#f8f8f8' }, preset: true }
]

// 不遵循 prefers-color-scheme 的服务需要注入 localStorage 后重载
const NEEDS_THEME_RELOAD = new Set(['doubao', 'metaso', 'minimax'])

// ===== Constants =====
const MODE = { WINDOW: 'window', MENUBAR: 'menubar' } as const
const SIDEBAR_WIDTH = 74
const EDGE_WIDTH = 0
const EDGE_PILL_WIDTH = 20
const EDGE_PILL_HEIGHT = 112
const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

// ===== Timing Constants =====
const UPDATE_CHECK_DELAY_MS = 5000      // 启动后延迟检查更新
const THEME_RELOAD_DELAY_MS = 100       // 主题切换后重载延迟
const THEME_INJECT_DELAY_MS = 300       // 需重载服务商的主题注入延迟
const ICON_FETCH_TIMEOUT_MS = 3000      // 图标获取超时
const HTML_ICONS_TIMEOUT_MS = 5000      // HTML 解析图标超时
const BOUNDS_SAVE_DELAY_MS = 500        // 窗口位置保存延迟
const RESIZE_UPDATE_DELAY_MS = 16       // 窗口大小更新延迟（约 60fps）
const EDGE_FADE_MS = 260                // 边缘条淡出后销毁的兜底延迟（CSS 渐变 150ms）
const NOTIFY_ICON_CLEANUP_MS = 60000    // 通知图标清理阈值（1 分钟）
const PAGE_TITLE_SYNC_DEBOUNCE_MS = 500 // 窗口标题同步防抖

// ===== 本地服务拉起 =====
const HEALTH_CHECK_TIMEOUT_MS = 3000    // 健康检查单次超时
const HEALTH_POLL_INTERVAL_MS = 500     // 拉起后健康轮询间隔
const LAUNCH_WAIT_TIMEOUT_MS = 30000    // 拉起等待总超时

// ===== 通知收件箱 =====
const NOTIFY_MAX_HISTORY = 500          // 通知历史上限（环形缓冲）
const NOTIFY_TITLE_MAX = 100            // title 截断长度
const NOTIFY_BODY_MAX = 500             // body 截断长度
const NOTIFY_RATE_PER_MIN = 10          // 每应用每分钟入列上限
const TITLE_NOTIFY_DEBOUNCE_MS = 2000   // 标题通知防抖（2s 内合并）
const TITLE_NOTIFY_RATE_PER_MIN = 2     // 标题通知每应用每分钟上限

// ===== Theme Scripts =====
const THEME_KEYS = JSON.stringify(['theme','darkMode','theme-mode','app_theme','THEME_MODE','arco-theme','themeType','byte_theme'])

function buildThemeScript(t: string): string {
  return `(function(){var t='${t}';var k=${THEME_KEYS};k.forEach(function(x){try{localStorage.setItem(x,t)}catch(e){}});document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.add(t);document.documentElement.classList.remove(t==='dark'?'light':'dark');try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t}))}catch(e){}})()`
}

const THEME_SCRIPTS: Record<string, string> = {
  dark: buildThemeScript('dark'),
  light: buildThemeScript('light')
}

// ===== Notification Hook =====
// 拦截页面内的 Notification API，通过 window.postMessage 交给 bridge-preload
// 转发到主进程（来源由主进程按 webContents 反查，页面无法伪造 appKey）。
function buildNotifyHook(): string {
  return `(function(){var O=window.Notification;window.Notification=function(t,o){try{window.postMessage({type:'__MINEAI_NOTIFY__',payload:{title:t,body:o&&o.body||'',icon:o&&o.icon||''}},'*')}catch(e){}return new O(t,o)};Object.keys(O).forEach(function(k){try{window.Notification[k]=O[k]}catch(e){}});window.Notification.prototype=O.prototype;window.Notification.requestPermission=function(cb){var p=Promise.resolve('granted');if(cb){cb('granted')}return p}})()`
}

// ===== Shortcut Matching =====
const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

interface Shortcut {
  mods: Set<string>
  key: string
}

function parseShortcut(str: string): Shortcut | null {
  if (!str) return null
  const parts = str.split('+')
  const mods = new Set(parts.filter(p => MODIFIERS.has(p)))
  const key = parts.find(p => !MODIFIERS.has(p))
  if (!key) return null
  return { mods, key }
}

interface KeyEvent {
  type: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
  code: string
}

function matchesKeyEvent(input: KeyEvent, shortcutStr: string): boolean {
  if (input.type !== 'keyDown') return false
  const parsed = parseShortcut(shortcutStr)
  if (!parsed) return false
  if (input.meta !== parsed.mods.has('Meta')) return false
  if (input.control !== parsed.mods.has('Control')) return false
  if (input.alt !== parsed.mods.has('Alt')) return false
  if (input.shift !== parsed.mods.has('Shift')) return false
  const keyCode = input.code.startsWith('Key') ? input.code.slice(3) : input.code
  return keyCode === parsed.key
}

export {
  PRESET_WEB_APPS,
  NEEDS_THEME_RELOAD,
  MODE,
  SIDEBAR_WIDTH,
  EDGE_WIDTH,
  EDGE_PILL_WIDTH,
  EDGE_PILL_HEIGHT,
  POPUP_WIDTH,
  POPUP_HEIGHT,
  THEME_SCRIPTS,
  buildNotifyHook,
  parseShortcut,
  matchesKeyEvent,
  // Timing constants
  UPDATE_CHECK_DELAY_MS,
  THEME_RELOAD_DELAY_MS,
  THEME_INJECT_DELAY_MS,
  ICON_FETCH_TIMEOUT_MS,
  HTML_ICONS_TIMEOUT_MS,
  BOUNDS_SAVE_DELAY_MS,
  RESIZE_UPDATE_DELAY_MS,
  EDGE_FADE_MS,
  NOTIFY_ICON_CLEANUP_MS,
  PAGE_TITLE_SYNC_DEBOUNCE_MS,
  // 本地服务拉起
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_POLL_INTERVAL_MS,
  LAUNCH_WAIT_TIMEOUT_MS,
  // 通知收件箱
  NOTIFY_MAX_HISTORY,
  NOTIFY_TITLE_MAX,
  NOTIFY_BODY_MAX,
  NOTIFY_RATE_PER_MIN,
  TITLE_NOTIFY_DEBOUNCE_MS,
  TITLE_NOTIFY_RATE_PER_MIN
}
