import { resolve } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const repoRoot = import.meta.dirname

export default defineConfig({
  test: {
    reporters: [
      'default',
      ...(process.env.GITHUB_ACTIONS ? ['github-actions' as const] : []),
      ['junit', { outputFile: 'test-results/ui-stories/junit.xml' }],
    ],
    projects: [
      {
        plugins: [
          storybookTest({
            configDir: resolve(repoRoot, '.storybook'),
            tags: {
              include: ['public'],
              exclude: ['internal'],
              skip: [],
            },
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: 'chromium' }],
            trace: {
              mode: 'retain-on-failure',
              tracesDir: 'test-results/ui-stories/traces',
            },
          },
        },
      },
    ],
  },
})
