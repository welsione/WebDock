# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm install               # 安装依赖
npm run dev               # 启动开发模式（electron .）
npm run build:mac         # 仅打包 macOS DMG
npm run release:mac        # 清理 + 打包 + 复制到 release/
```

GitHub 推送需要代理：
```bash
export http_proxy="http://127.0.0.1:9981" https_proxy="http://127.0.0.1:9981"
```

发布流程：`scripts/build.sh` 构建后，用 `gh release create` 上传 `release/` 下的 dmg 文件。

## 架构

### 主进程 (electron/main.js)

- **双模式** — `WINDOW` 和 `MENUBAR` 两种运行模式，通过托盘菜单或 `setMode()` 切换
- **BrowserView 缓存** — `const views = new Map()`，每个 AI 服务商对应一个 BrowserView，切换时缓存不销毁，保留对话状态
- **Provider 配置** — `PROVIDERS` 数组定义服务商 key/name/url/icon，`PROVIDERS.find(p => p.key === key)` 查找
- **主题注入** — 通过 `view.webContents.executeJavaScript()` 注入 localStorage 脚本切换明暗主题。豆包和秘塔不遵循 `prefers-color-scheme`，需额外 `reload()`（见 `NEEDS_THEME_RELOAD`）
- **专注模式** — 创建独立边缘条窗口（`edgeWindow`），可拖拽移动父窗口
- **状态同步** — 渲染进程通过 IPC 通知主进程主题变化和侧边栏状态

### 预加载脚本

- **electron/preload.js** — 暴露 `window.electronAPI`，封装所有 IPC 通信（切换服务、模式、主题、快捷键等）
- **electron/edge-preload.js** — 暴露 `window.edgeAPI`，处理边缘条窗口的退出专注和拖拽

### 渲染进程 (src/)

- `index.html` — 主窗口和 popup 共用的 UI 页面
- `edge.html` — 边缘条窗口 UI

### 打包配置 (electron-builder.yml)

- `appId: com.mineai.hub`，`productName: MineAI Hub`
- 仅输出 macOS DMG，支持 x64 和 arm64 双架构
- asar 打包，`--files` 仅包含 `electron/**/*`、`src/**/*`、`package.json`

## 注意事项

- `BrowserView` 没有 `isDestroyed()` 方法，需通过 `view.webContents.isDestroyed()` 判断。访问前必须先检查 `view.webContents` 存在，否则为 undefined
- `view.webContents` 在 BrowserView 创建后始终存在，但窗口关闭或部分销毁后可能变为 undefined
- 打包产物到 GitHub 推送需要代理 `http://127.0.0.1:9981`
- 当前仅支持 macOS，未适配 Windows/Linux
