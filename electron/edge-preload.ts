import { contextBridge, ipcRenderer } from 'electron'

interface EdgeAPI {
  exitFocus: () => void
  moveWindow: (dx: number, dy: number) => void
  onThemeChange: (callback: (theme: string) => void) => void
}

// 单次监听辅助：先移除旧 listener 再注册新的，防止累积
function onceOn(channel: string, callback: (...args: unknown[]) => void): void {
  ipcRenderer.removeAllListeners(channel)
  ipcRenderer.on(channel, (_event, ...args: unknown[]) => callback(...args))
}

contextBridge.exposeInMainWorld('edgeAPI', {
  exitFocus: () => ipcRenderer.send('exit-focus'),
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('move-window', dx, dy),
  onThemeChange: (callback: (theme: string) => void) => onceOn('edge-theme-changed', (theme) => callback(theme as string))
} satisfies EdgeAPI)