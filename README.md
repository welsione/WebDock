# MineAI Hub

一站式 AI 服务聚合桌面应用，将 DeepSeek、豆包、Kimi、秘塔等主流 AI 对话平台整合在单一窗口中，无需浏览器即可访问。

![Version](https://img.shields.io/badge/version-1.0.2-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)
![Stars](https://img.shields.io/github/stars/welsione/MineAI-Hub?style=flat)
![Downloads](https://img.shields.io/github/downloads/welsione/MineAI-Hub/total)

## 截图

![主界面](image/mineai_main.png)

![专注模式](image/mineai_focus.png)

## 下载

macOS（Apple Silicon / Intel）：

[下载 MineAI Hub v1.0.2](https://github.com/welsione/MineAI-Hub/releases/tag/v1.0.2)

> 首次打开提示"已损坏"是 macOS Gatekeeper 对未签名应用的阻拦，在终端执行以下命令后重新打开即可：
> ```bash
> xattr -cr /Applications/MineAI\ Hub.app
> ```

## 功能

- **多服务聚合** — 侧边栏一键切换 DeepSeek / 豆包 / Kimi / 秘塔
- **服务缓存** — 切换不刷新页面，保留对话状态
- **全局快捷键** — `Cmd+Shift+Space` 唤起 / 隐藏窗口，支持自定义
- **专注模式** — 隐藏侧边栏，沉浸式对话
- **明暗主题** — 跟随系统或手动切换，服务页面同步变色
- **边缘条拖拽** — 专注模式下拖拽边缘悬浮条移动窗口
- **快捷键切换服务商** — 键盘快速轮换 AI 服务，支持自定义

## 快捷键

| 默认快捷键 | 功能 | 可自定义 |
|-----------|------|:--------:|
| `Cmd + Shift + Space` | 唤起 / 隐藏窗口 | 是 |
| `Shift + Tab` | 切换服务商 | 是 |
| `Cmd + ,` | 打开设置 | 否 |

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

成品输出到 `release/` 目录。

## FAQ

**打开提示"已损坏"？**  
应用未经过 Apple 代码签名，执行 `xattr -cr /Applications/MineAI\ Hub.app` 即可。

**支持 Windows / Linux 吗？**  
当前仅支持 macOS，暂未适配其他平台。

**切换服务会重新加载页面吗？**  
不会。使用 BrowserView 缓存机制，切换服务保留原页面状态，避免重复加载。

## 更新日志

详见 [GitHub Releases](https://github.com/welsione/MineAI-Hub/releases)。

## 许可

MIT
