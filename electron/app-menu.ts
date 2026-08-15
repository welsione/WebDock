// ===== 应用菜单模块 =====
// 负责构建 macOS 应用菜单

import { app, Menu } from 'electron'
import { getMergedWebApps, getCurrentWebAppKey, switchWebApp, getCurrentView } from './browser-view-manager'
import { showMainWindow, getMainWindowRef } from './window-manager'
import { showNativeNotification } from './notification-bridge'

export function buildMenu(): void {
  const isDev = !app.isPackaged
  const base: Electron.MenuItemConstructorOptions[] = [
    { label: 'WebDock', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]
  if (isDev) {
    base.push({
      label: '开发',
      submenu: [
        {
          label: '打开网页应用 DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const v = getCurrentView()
            if (v?.webContents && !v.webContents.isDestroyed()) v.webContents.openDevTools({ mode: 'detach' })
          }
        },
        {
          label: '打开主窗口 DevTools',
          click: () => {
            const w = getMainWindowRef()
            if (w && !w.isDestroyed()) w.webContents.openDevTools({ mode: 'detach' })
          }
        },
        { type: 'separator' },
        {
          label: '发送测试通知',
          click: () => {
            const p = getMergedWebApps().find(x => x.key === getCurrentWebAppKey())
            if (p) {
              void showNativeNotification(`${p.name} — 测试通知`, '来自 WebDock 的测试消息', p.icon, () => {
                void switchWebApp(p.key)
                showMainWindow()
              })
            }
          }
        }
      ]
    } as Electron.MenuItemConstructorOptions)
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(base))
}
