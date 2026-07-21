import { resolve } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const repoRoot = import.meta.dirname

export default defineConfig({
  optimizeDeps: {
    include: [
      '@base-ui/react/field',
      '@base-ui/react/fieldset',
      '@base-ui/react/form',
      '@tanstack/react-router',
      'react-markdown',
      'rehype-highlight',
      'remark-gfm',
    ],
  },
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
          // The Playwright provider keys retained traces by story title only;
          // serial files prevent common names such as "Sizes" from colliding.
          fileParallelism: false,
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
