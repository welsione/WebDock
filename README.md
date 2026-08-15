# WebDock

把任意网页**和本地服务**变成原生桌面应用——聚合、系统通知、按需拉起。

还在浏览器标签页之间反复横跳？WebDock 把 DeepSeek、豆包、Kimi、Notion、邮件、内网面板……**任何网页**都装进侧边栏，一键切换、会话常驻；网页通知统一接入 **macOS 系统通知**（点击直达对应应用，历史与分组由系统通知中心管理）；本地服务（`dsh web`、Ollama、LM Studio）未运行时**切换即自动拉起**。

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## 定位

> 浏览器把网页当"页面"，WebDock 把它当"应用"。

为重度网页工具用户（开发者、创作者、知识工作者）打造：

1. **聚合** — 任意 URL（含 `127.0.0.1` 本地服务）一键接入，切换不刷新、会话常驻
2. **通知统一** — 网页通知接入 macOS 系统通知：去重、限频防刷屏、点击直达对应应用、每应用可单独关闭
3. **本地服务自拉起** — 配置启动命令（如 `dsh web`、`ollama serve`），切换时健康检查，未运行自动拉起并等待就绪
4. **桌面原生化** — 原生右键菜单、窗口标题跟随页面、跨域链接外部打开、音频独占、每应用权限与自签名证书信任

## 快速开始

```bash
npm install
npm run dev
```

## 添加网页应用

设置 → 网页应用管理 → 添加网页应用，填写：

| 字段 | 说明 |
|---|---|
| 名称 / 网址 | 网址支持任意 http/https 主机（含 localhost / 局域网 IP） |
| 图标 | 本地图片（≤256KB）或网址自动获取；填写网址失焦自动补全名称与图标 |
| 启动命令 | 可选。本地服务场景：如 `dsh web` / `ollama serve` / `cd ~/proj && pnpm dev` |
| 健康检查地址 | 可选，默认 = 网址；**任何 HTTP 响应（含 404/500）都视为服务在运行** |
| 退出时关闭服务 | 默认不关（服务可能被 CLI 独立使用）；开启后退出 WebDock 时自动停止 |
| 通知 | 每应用可关闭"转发 macOS 系统通知" |
| 权限 | 摄像头 / 麦克风 / 定位按应用开关（默认拒绝） |
| 信任自签名证书 | 本地 https 服务（NAS / 内网）场景 |

### 示例：dsh web（DeepSeek Harness Web GUI）

1. 添加网页应用：网址 `http://127.0.0.1:3080`，名称 `DSH`
2. 启动命令填 `dsh web`（健康检查默认用网址）
3. 之后每次切换到 DSH：未启动 → 自动拉起 → 加载页面；已在运行 → 直接打开

服务日志输出到 `~/Library/Application Support/WebDock/logs/<应用名>.log`，启动超时（30 秒）时按提示查看。

## 通知（macOS 系统通知）

- 网页内的 `Notification` 通知统一接入 **macOS 系统通知**：历史记录、分组、勿扰由系统通知中心管理，点击通知直达对应网页应用
- 每应用可在编辑弹窗中单独关闭系统通知转发
- 不可信防护：内容截断、每应用限频（防刷屏）、同内容去重合并、来源归属按窗口反查（页面无法伪造）
- 通知历史本地持久化（上限 500 条），设置"退出时清空"可选

> **边界说明**：WebDock 只能接收"页面打开时"产生的通知。网页关闭后的后台推送（Web Push / Service Worker）受限于 Electron 能力无法接收。

## 从 MineAI Hub 升级（v1.x → v2.0）

- 首次启动自动将旧目录（`Application Support/MineAI Hub`）的设置与登录会话搬迁到 `Application Support/WebDock`，旧目录保留不删
- 原有 7 个 AI 服务商 + 自定义服务商自动迁移为统一"网页应用"模型，顺序与颜色保留
- 更新源（appId）保持不变，升级后自动更新仍可用

## 快捷键

| 默认快捷键 | 功能 | 可自定义 |
|-----------|------|:--------:|
| `Cmd + Shift + Space` | 唤起 / 隐藏窗口 | 是 |
| `Shift + Tab` | 切换网页应用 | 是 |
| `Cmd + ,` | 打开设置 | 否 |

## 技术栈

- Electron 35 + BrowserView + TypeScript
- 原生 CSS 变量主题系统（跟随系统 / 手动切换，网页侧同步注入）

## 打包

```bash
npm run release:mac
```

成品输出到 `release/` 目录（双架构 DMG + `latest-mac.yml`）。

> 未签名应用首次打开提示"已损坏"时：`xattr -cr /Applications/WebDock.app`

## 开发

```bash
npm run dev        # 开发模式（热重载）
npm test           # 单元测试（175 个）
npm run test:coverage
npm run lint
npx tsc --project tsconfig.node.json --noEmit   # 主进程类型检查
npx tsc --project tsconfig.web.json --noEmit    # 渲染进程类型检查
```

## FAQ

**支持 Windows / Linux 吗？** 当前仅支持 macOS。

**切换网页应用会重新加载页面吗？** 不会。BrowserView 缓存机制保留各应用会话状态。

**服务拉起失败怎么办？** 查看 `~/Library/Application Support/WebDock/logs/<应用名>.log`；常见原因：命令不存在、端口被占用、启动超过 30 秒。

**为什么收不到某网站的通知？** 该网站可能不使用 Notification API；可开启该应用的"标题变化通知"。

## 许可

MIT
