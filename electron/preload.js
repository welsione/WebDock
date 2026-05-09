const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 切换服务
  switchProvider: (key) => ipcRenderer.send('switch-provider', key),

  // 重载当前页面
  reload: () => ipcRenderer.send('reload'),

  // 切换模式
  toggleMode: () => ipcRenderer.invoke('toggle-mode'),

  // 获取当前模式
  getMode: () => ipcRenderer.invoke('get-mode'),

  // 获取当前服务
  getCurrentProvider: () => ipcRenderer.invoke('get-current-provider'),

  // 获取所有服务
  getProviders: () => ipcRenderer.invoke('get-providers'),

  // 监听加载状态
  onLoading: (callback) => {
    ipcRenderer.on('loading', (event, data) => callback(data))
  },

  // 监听模式变化
  onModeChange: (callback) => {
    ipcRenderer.on('mode-changed', (event, mode) => callback(mode))
  },

  // 通知侧边栏状态变化（专注模式）
  notifySidebarState: (collapsed) => ipcRenderer.send('sidebar-state', collapsed),

  // 通知主题变化（用于同步边缘条窗口）
  notifyThemeChange: (theme) => ipcRenderer.send('theme-changed', theme),

  // 监听退出专注模式
  onExitFocusMode: (callback) => {
    ipcRenderer.on('exit-focus-mode', () => callback())
  },

  // 快捷键设置
  getShortcut: () => ipcRenderer.invoke('get-shortcut'),
  setShortcut: (acc) => ipcRenderer.invoke('set-shortcut', acc),

  // 切换服务商快捷键
  getSwitchShortcut: () => ipcRenderer.invoke('get-switch-shortcut'),
  setSwitchShortcut: (acc) => ipcRenderer.invoke('set-switch-shortcut', acc),

  // 设置页面显隐
  toggleSettings: (show) => ipcRenderer.send('toggle-settings', show)
})
