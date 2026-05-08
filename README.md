# MineAI Hub

AI 服务聚合桌面应用，一站式访问 DeepSeek、豆包、Kimi、秘塔等主流 AI 对话平台。

## 功能

- **多服务聚合** — 侧边栏一键切换 DeepSeek / 豆包 / Kimi / 秘塔
- **窗口 / 菜单栏双模式** — 独立窗口或常驻菜单栏弹出面板，Cmd+M 切换
- **明暗主题** — 跟随系统或手动切换，服务页面同步变色
- **专注模式** — 隐藏侧边栏，左侧边缘条点击退出
- **服务缓存** — 切换服务不刷新页面，保留对话状态

## 技术栈

- Electron 33 + BrowserView
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
