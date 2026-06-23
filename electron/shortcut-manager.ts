// ===== 快捷键管理模块 =====
// 负责全局快捷键的注册、注销和切换

import { globalShortcut } from 'electron'
import log from 'electron-log'

let currentShortcut = 'Cmd+Shift+Space'

// ===== 切换窗口可见性（由外部注入） =====
let toggleWindowVisibility: (() => void) | null = null

export function setToggleHandler(handler: () => void): void {
  toggleWindowVisibility = handler
}

// ===== 获取当前快捷键 =====
export function getCurrentShortcut(): string {
  return currentShortcut
}

// ===== 设置快捷键（不注册） =====
export function setCurrentShortcut(acc: string): void {
  currentShortcut = acc
}

// ===== 注册全局快捷键 =====
export function registerGlobalShortcut(acc: string): { ok: boolean; error?: string } {
  // 先注销当前快捷键
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
  }
  if (!acc) {
    currentShortcut = ''
    return { ok: true }
  }
  if (!toggleWindowVisibility) {
    return { ok: false, error: '切换处理器未初始化' }
  }
  const registered = globalShortcut.register(acc, toggleWindowVisibility)
  if (registered) {
    currentShortcut = acc
    return { ok: true }
  }
  // 注册失败，尝试恢复旧快捷键
  if (currentShortcut) {
    const restored = globalShortcut.register(currentShortcut, toggleWindowVisibility)
    if (!restored) {
      log.error('Failed to restore previous shortcut:', currentShortcut)
    }
  }
  return { ok: false, error: '快捷键被占用或无效，请尝试其他组合' }
}

// ===== 注销所有快捷键 =====
export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll()
}
