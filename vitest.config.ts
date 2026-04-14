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
      '@bakin/core/openclaw-home': path.resolve(__dirname, 'packages/core/src/openclaw-home.ts'),
      '@bakin/core/main-agent': path.resolve(__dirname, 'packages/core/src/main-agent.ts'),
      '@bakin/core/content-dir': path.resolve(__dirname, 'packages/core/src/content-dir.ts'),
      '@bakin/core/settings': path.resolve(__dirname, 'packages/core/src/settings.ts'),
      '@bakin/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@bakin/tasks': path.resolve(__dirname, 'plugins/tasks'),
      '@bakin/memory': path.resolve(__dirname, 'plugins/memory'),
      '@bakin/models': path.resolve(__dirname, 'plugins/models'),
      '@bakin/messaging': path.resolve(__dirname, 'plugins/messaging'),
      '@bakin/workflows': path.resolve(__dirname, 'plugins/workflows'),
      '@bakin/assets': path.resolve(__dirname, 'plugins/assets'),
      '@bakin/schedule': path.resolve(__dirname, 'plugins/schedule'),
    },
  },
})
