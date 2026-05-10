const { app } = require('electron')
const path = require('path')
const fs = require('fs')

// ===== Icon Loading =====
const iconBaseDir = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '..', 'assets')
function loadIcon(name) {
  return `data:image/png;base64,${fs.readFileSync(path.join(iconBaseDir, name)).toString('base64')}`
}

// ===== Providers =====
const PROVIDERS = [
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: loadIcon('deepseek.png') },
  { key: 'doubao',   name: '豆包',     url: 'https://www.doubao.com/chat/',  icon: loadIcon('doubao.png') },
  { key: 'kimi',     name: 'Kimi',     url: 'https://kimi.moonshot.cn/',     icon: loadIcon('kimi.png') },
  { key: 'metaso',   name: 'Metaso',   url: 'https://metaso.cn/',            icon: loadIcon('metaso.png') }
]

// 不遵循 prefers-color-scheme 的服务需要注入 localStorage 后重载
const NEEDS_THEME_RELOAD = new Set(['doubao', 'metaso'])

// ===== Constants =====
const MODE = { WINDOW: 'window', MENUBAR: 'menubar' }
const THEME = { DARK: 'dark', LIGHT: 'light' }
const SIDEBAR_WIDTH = 74
const EDGE_WIDTH = 0
const EDGE_PILL_WIDTH = 16
const EDGE_PILL_HEIGHT = 48
const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

// ===== Theme Scripts =====
const THEME_BG = { [THEME.DARK]: '#0d0f14', [THEME.LIGHT]: '#ffffff' }

const THEME_KEYS = JSON.stringify(['theme','darkMode','theme-mode','app_theme','THEME_MODE','arco-theme','themeType','byte_theme'])

function buildThemeScript(t) {
  return `(function(){var t='${t}';var k=${THEME_KEYS};k.forEach(function(x){try{localStorage.setItem(x,t)}catch(e){}});document.documentElement.setAttribute('data-theme',t);document.documentElement.classList.add(t);document.documentElement.classList.remove(t==='dark'?'light':'dark');try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t}))}catch(e){}})()`
}

const THEME_SCRIPTS = {
  [THEME.DARK]: buildThemeScript('dark'),
  [THEME.LIGHT]: buildThemeScript('light')
}

// ===== Shortcut Matching =====
const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

function parseShortcut(str) {
  if (!str) return null
  const parts = str.split('+')
  const mods = new Set(parts.filter(p => MODIFIERS.has(p)))
  const key = parts.find(p => !MODIFIERS.has(p))
  if (!key) return null
  return { mods, key }
}

function matchesKeyEvent(input, shortcutStr) {
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

module.exports = {
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
  matchesKeyEvent
}
