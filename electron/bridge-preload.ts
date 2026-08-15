// ===== 网页应用 BrowserView 通知桥 preload =====
// 页面通过 window.postMessage({ type: '__MINEAI_NOTIFY__', payload }) 上报通知；
// preload 不向页面暴露任何 API（第三方页面零 IPC 红线），仅把消息转发给主进程。
// 来源归属由主进程按 webContents 反查（页面无法伪造 appKey）。

import { ipcRenderer } from 'electron'

const BRIDGE_TYPE = '__MINEAI_NOTIFY__'

window.addEventListener('message', (e: MessageEvent) => {
  const data = e.data
  if (!data || typeof data !== 'object') return
  if ((data as Record<string, unknown>).type !== BRIDGE_TYPE) return
  const payload = (data as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return
  ipcRenderer.send('webapp-notify', payload)
})
