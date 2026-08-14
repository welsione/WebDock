import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'electron/config.ts',
        'electron/settings-store.ts',
        'electron/browser-view-manager.ts',
        'electron/window-manager.ts',
        'electron/icons.ts',
        'src/state.ts',
        'src/ui/loading.ts',
        'src/utils/escape-html.ts'
      ],
      // 按文件分级阈值：
      // - 核心纯逻辑（渲染进程 + 配置/持久化）：高门槛，新增未测试代码直接失败，防"假绿"回归
      // - BrowserView/窗口等依赖 Electron 运行时：仅纳入报告，不设门槛（node 环境不可测）
      thresholds: {
        lines: {
          'electron/config.ts': 80,
          'electron/settings-store.ts': 90,
          'src/state.ts': 85,
          'src/ui/loading.ts': 80,
          'src/utils/escape-html.ts': 90
        },
        functions: {
          'electron/config.ts': 80,
          'electron/settings-store.ts': 90,
          'src/state.ts': 85,
          'src/ui/loading.ts': 80,
          'src/utils/escape-html.ts': 90
        },
        branches: {
          'electron/settings-store.ts': 80,
          'src/state.ts': 80,
          'src/utils/escape-html.ts': 80
        }
      }
    }
  }
})
