# MineAI Hub

AI 服务聚合桌面应用，一站式访问 DeepSeek、豆包、Kimi、秘塔等主流 AI 对话平台。

无需浏览器，一个应用搞定所有 AI 服务。

## 截图

![主界面](image/mineai_main.png)

![专注模式](image/mineai_focus.png)

## 下载

macOS（Apple Silicon / Intel）：

[下载 MineAI Hub v1.0.2](https://github.com/welsione/MineAI-Hub/releases/tag/v1.0.2)

> 首次打开提示"已损坏"，在终端执行：
> ```bash
> xattr -cr /Applications/MineAI\ Hub.app
> ```
> 然后重新打开即可。这是因为未经过 Apple 代码签名。

## 功能

### 多服务聚合
侧边栏一键切换 DeepSeek / 豆包 / Kimi / 秘塔，切换服务不刷新页面，保留对话状态。

### 全局快捷键
按 `Cmd+Shift+Space` 快速唤起或隐藏窗口，随时调出 AI 助手。支持在设置中自定义快捷键。

### 专注模式
隐藏侧边栏进入沉浸式对话，左侧边缘悬浮条随时点击退出。

### 主题切换
支持明暗主题，跟随系统偏好或手动切换，服务页面同步变色。

### 设置面板
macOS 风格设置页面，可配置主题、全局快捷键等选项。

## 技术栈

- Electron 35 + BrowserView
- 原生 CSS 变量主题系统

## 开发

```bash
npm install
npm run dev
```

## 打包

```bash
npm run release:mac
```

成品在 `release/` 目录，中间产物在 `dist/`。

## 许可

MIT
