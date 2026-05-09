const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('edgeAPI', {
  exitFocus: () => ipcRenderer.send('exit-focus'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  onThemeChange: (callback) => {
    ipcRenderer.on('edge-theme-changed', (event, theme) => callback(theme))
  }
})
