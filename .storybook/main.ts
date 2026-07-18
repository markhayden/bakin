import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../storybook/**/*.stories.@(ts|tsx)'],
  addons: [],
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import('vite')
    return mergeConfig(viteConfig, {
      resolve: {
        alias: {
          '@': sourceRoot,
        },
      },
    })
  },
}

export default config
