import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/core/**', 'src/lib/**', 'plugins/**'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@mc/tasks': path.resolve(__dirname, 'plugins/tasks'),
      '@mc/memory': path.resolve(__dirname, 'plugins/memory'),
      '@mc/models': path.resolve(__dirname, 'plugins/models'),
      '@mc/calendar': path.resolve(__dirname, 'plugins/calendar'),
      '@mc/workflows': path.resolve(__dirname, 'plugins/workflows'),
    },
  },
})
