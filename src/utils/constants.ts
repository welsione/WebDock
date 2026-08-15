// ===== 渲染进程常量 =====
// 与主进程 electron/config.ts 中的对应值保持同步
// 渲染进程无法直接 import 主进程模块，因此在此独立定义

export const FOCUS_NOTIFY_DELAY_MS = 250    // 专注模式通知延迟
export const RELOAD_COOLDOWN_MS = 1000     // 重载冷却时间
export const TOAST_DURATION_MS = 1600      // Toast 显示时间
export const STATUS_DURATION_MS = 2000     // 状态指示器显示时间
export const MIN_LOADING_MS = 200          // 加载遮罩最小显示时间
export const EDGE_CLICK_THRESHOLD_PX = 3   // 边缘条拖拽阈值（小于此值视为点击）
export const MAX_ICON_UPLOAD_BYTES = 256 * 1024 // 图标上传大小限制 256KB
