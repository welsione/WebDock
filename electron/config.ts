import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// ===== Icon Loading =====
const iconBaseDir = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '..', '..', 'assets')

function loadIcon(name: string): string {
  const ext = path.extname(name).toLowerCase()
  const mimeMap: Record<string, string> = { '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg' }
  const mime = mimeMap[ext] || 'image/png'
  return `data:${mime};base64,${fs.readFileSync(path.join(iconBaseDir, name)).toString('base64')}`
}

// ===== Providers =====
interface ProviderColor {
  dark: string
  light: string
}

interface Provider {
  key: string
  name: string
  url: string
  icon: string
  color: ProviderColor
}

const PROVIDERS: Provider[] = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: loadIcon('deepseek.png'), color: { dark: '#151517', light: '#ffffff' } },
  { key: 'doubao',   name: '豆包',     url: 'https://www.doubao.com/chat/',  icon: loadIcon('doubao.png'), color: { dark: '#1f1f1f', light: '#f9f9f9' } },
  { key: 'kimi',     name: 'Kimi',     url: 'https://kimi.moonshot.cn/',     icon: loadIcon('kimi.png'), color: { dark: '#151616', light: '#ffffff' } },
  { key: 'metaso',   name: 'Metaso',   url: 'https://metaso.cn/',            icon: loadIcon('metaso.png'), color: { dark: '#16181e', light: '#fbfbfa' } },
  { key: 'qianwen',  name: '千问',     url: 'https://www.qianwen.com/',      icon: loadIcon('qianwen.png'), color: { dark: '#111112', light: '#f7f7f9' } },
  { key: 'minimax',  name: 'MiniMax',  url: 'https://agent.minimaxi.com/',   icon: loadIcon('minimax.png'), color: { dark: '#171717', light: '#ffffff' } },
  { key: 'zhipu',    name: '智谱',     url: 'https://chat.z.ai/',            icon: loadIcon('zhipu.png'), color: { dark: '#161616', light: '#f8f8f8' } }
]

// 不遵循 prefers-color-scheme 的服务需要注入 localStorage 后重载
const NEEDS_THEME_RELOAD = new Set(['doubao', 'metaso', 'minimax'])

// 各服务商聊天输入框选择器（用于剪贴板注入，未列出的使用默认选择器）
const CHAT_INPUT_SELECTORS: Record<string, string> = {
  // 当前所有服务商都使用默认选择器，如需特殊处理在此覆盖
  // deepseek: 'textarea.ChatInput...',
}

// ===== Constants =====
const MODE = { WINDOW: 'window', MENUBAR: 'menubar' } as const
const THEME = { DARK: 'dark', LIGHT: 'light' } as const
const SIDEBAR_WIDTH = 74
const EDGE_WIDTH = 0
const EDGE_PILL_WIDTH = 16
const EDGE_PILL_HEIGHT = 72
const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

// ===== Theme Scripts =====
const THEME_BG: Record<string, string> = { [THEME.DARK]: '#0d0f14', [THEME.LIGHT]: '#ffffff' }

const THEME_KEYS = JSON.stringify(['theme','darkMode','theme-mode','app_theme','THEME_MODE','arco-theme','themeType','byte_theme'])

function buildThemeScript(t: string): string {
  return `(function(){var t='${t}';var k=${THEME_KEYS};k.forEach(function(x){try{localStorage.setItem(x,t)}catch(e){}});document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.add(t);document.documentElement.classList.remove(t==='dark'?'light':'dark');try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t}))}catch(e){}})()`
}

const THEME_SCRIPTS: Record<string, string> = {
  [THEME.DARK]: buildThemeScript('dark'),
  [THEME.LIGHT]: buildThemeScript('light')
}

// ===== Notification Bridge =====
// 拦截页面内的 Notification API，通过 console.log 桥接回主进程，转发为原生通知
// 接受 providerKey 和 icon 参数，直接嵌入到桥接消息中，避免主进程反查 webContents
function buildNotifyBridge(providerKey: string, icon: string): string {
  const safeKey = JSON.stringify(providerKey)
  const safeIcon = JSON.stringify(icon)
  return `(function(){var O=window.Notification;var PREFIX='__MINEAI_NOTIFY__:';var KEY=${safeKey};var ICO=${safeIcon};window.Notification=function(t,o){try{console.log(PREFIX+JSON.stringify({title:t,body:o&&o.body||'',icon:o&&o.icon||'',tag:o&&o.tag||'',_key:KEY,_ico:ICO}))}catch(e){}return new O(t,o)};Object.keys(O).forEach(function(k){try{window.Notification[k]=O[k]}catch(e){}});window.Notification.prototype=O.prototype;window.Notification.requestPermission=function(cb){var p=Promise.resolve('granted');if(cb){cb('granted')}return p}})()`
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
  PROVIDERS,
  NEEDS_THEME_RELOAD,
  MODE,
  THEME,
  SIDEBAR_WIDTH,
  EDGE_WIDTH,
  EDGE_PILL_WIDTH,
  EDGE_PILL_HEIGHT,
  POPUP_WIDTH,
  POPUP_HEIGHT,
  THEME_BG,
  THEME_SCRIPTS,
  CHAT_INPUT_SELECTORS,
  buildNotifyBridge,
  parseShortcut,
  matchesKeyEvent
}

export type { Provider, ProviderColor, KeyEvent }
