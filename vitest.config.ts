import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/core/**', 'src/lib/**', 'plugins/**', 'scripts/lib/**'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'bun:sqlite': path.resolve(__dirname, 'tests/shims/bun-sqlite.ts'),
      '@bakin/core/openclaw-home': path.resolve(__dirname, 'packages/core/src/openclaw-home.ts'),
      '@bakin/core/openclaw-config': path.resolve(__dirname, 'packages/core/src/openclaw-config.ts'),
      '@bakin/core/main-agent': path.resolve(__dirname, 'packages/core/src/main-agent.ts'),
      '@bakin/core/content-dir': path.resolve(__dirname, 'packages/core/src/content-dir.ts'),
      '@bakin/core/settings': path.resolve(__dirname, 'packages/core/src/settings.ts'),
      '@bakin/core/ids': path.resolve(__dirname, 'packages/core/src/ids.ts'),
      '@bakin/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@bakin/sdk/ui': path.resolve(__dirname, 'packages/sdk/src/ui/index.ts'),
      '@bakin/sdk/hooks': path.resolve(__dirname, 'packages/sdk/src/hooks/index.ts'),
      '@bakin/sdk/components': path.resolve(__dirname, 'packages/sdk/src/components/index.ts'),
      '@bakin/sdk/slots': path.resolve(__dirname, 'packages/sdk/src/slots/index.tsx'),
      '@bakin/sdk/types': path.resolve(__dirname, 'packages/sdk/src/types/index.ts'),
      '@bakin/sdk/utils': path.resolve(__dirname, 'packages/sdk/src/utils/index.ts'),
      '@bakin/sdk': path.resolve(__dirname, 'packages/sdk/src/index.ts'),
      '@bakin/tasks': path.resolve(__dirname, 'plugins/tasks'),
      '@bakin/memory': path.resolve(__dirname, 'plugins/memory'),
      '@bakin/models': path.resolve(__dirname, 'plugins/models'),
      '@bakin/messaging': path.resolve(__dirname, 'plugins/messaging'),
      '@bakin/workflows': path.resolve(__dirname, 'plugins/workflows'),
      '@bakin/assets': path.resolve(__dirname, 'plugins/assets'),
      '@bakin/schedule': path.resolve(__dirname, 'plugins/schedule'),
      '@bakin/team': path.resolve(__dirname, 'plugins/team'),
      '@bakin/projects': path.resolve(__dirname, 'plugins/projects'),
      '@bakin/health': path.resolve(__dirname, 'plugins/health'),
    },
  },
})
