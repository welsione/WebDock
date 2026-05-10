# MineAI Hub

AI 服务聚合桌面应用，一站式访问 DeepSeek、豆包、Kimi、秘塔等主流 AI 对话平台。

无需浏览器，一个应用搞定所有 AI 服务。

![Version](https://img.shields.io/badge/version-1.0.2-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/electron-35-9cf)
![Stars](https://img.shields.io/github/stars/welsione/MineAI-Hub?style=flat)
![Last Commit](https://img.shields.io/github/last-commit/welsione/MineAI-Hub)
![Downloads](https://img.shields.io/github/downloads/welsione/MineAI-Hub/total)

## 目录

- [截图](#截图)
- [下载](#下载)
- [功能](#功能)
- [快捷键](#快捷键)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [开发](#开发)
- [打包](#打包)
- [FAQ](#faq)
- [更新日志](#更新日志)
- [Star 历史](#star-历史)
- [参与贡献](#参与贡献)
- [许可](#许可)

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

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd + Shift + Space` | 唤起 / 隐藏窗口 |
| `Shift + Tab` | 切换服务商 |
| `Cmd + ,` | 打开设置 |
| `Cmd + Q` | 退出应用 |

> 全局快捷键和切换服务商快捷键均可在设置中自定义。

## 技术栈

- Electron 35 + BrowserView
- 原生 CSS 变量主题系统

## 项目结构

```
MineAI/
├── electron/          # Electron 主进程
│   ├── main.js        # 主进程入口
│   ├── preload.js     # 预加载脚本
│   └── edge-preload.js# 边缘条预加载
├── src/               # 渲染进程（UI 页面）
│   ├── index.html     # 主窗口
│   └── edge.html      # 边缘条
├── assets/            # 资源文件
├── scripts/           # 构建脚本
├── dist/              # 打包中间产物
├── release/           # 打包成品
└── package.json
```

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

## FAQ

**Q: 打开提示"已损坏"无法打开？**
macOS 下未签名的应用会被 Gatekeeper 阻止。在终端执行 `xattr -cr /Applications/MineAI\ Hub.app` 即可。

**Q: 会支持 Windows / Linux 吗？**
暂不支持。当前仅支持 macOS。

**Q: 会和浏览器标签页一样占用内存吗？**
BrowserView 具有缓存机制，切换服务不会重新加载页面，相比浏览器更节省资源。

## 更新日志

所有版本更新记录见 [GitHub Releases](https://github.com/welsione/MineAI-Hub/releases)。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=welsione/MineAI-Hub&type=Date)](https://star-history.com/#welsione/MineAI-Hub&Date)

## 参与贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 许可

MIT
