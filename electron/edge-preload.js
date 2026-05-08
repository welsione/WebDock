const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('edgeAPI', {
  exitFocus: () => ipcRenderer.send('exit-focus'),
  onThemeChange: (callback) => {
    ipcRenderer.on('edge-theme-changed', (event, theme) => callback(theme))
  }
})
