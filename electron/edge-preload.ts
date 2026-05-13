import { contextBridge, ipcRenderer } from 'electron'

interface EdgeAPI {
  exitFocus: () => void
  moveWindow: (dx: number, dy: number) => void
  onThemeChange: (callback: (theme: string) => void) => void
}

contextBridge.exposeInMainWorld('edgeAPI', {
  exitFocus: () => ipcRenderer.send('exit-focus'),
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('move-window', dx, dy),
  onThemeChange: (callback) => {
    ipcRenderer.on('edge-theme-changed', (_event, theme) => callback(theme))
  }
} satisfies EdgeAPI)
