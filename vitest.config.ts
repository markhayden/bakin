import { resolve } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const repoRoot = import.meta.dirname

export default defineConfig({
  test: {
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
          },
        },
      },
    ],
  },
})
