import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import { storyGlobsForAudience, type StorybookAudience } from './audiences.ts'

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))
const audience: StorybookAudience = process.env.BAKIN_STORYBOOK_AUDIENCE === 'public'
  ? 'public'
  : 'maintainer'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: storyGlobsForAudience(audience),
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  tags: {
    public: {},
    internal: {},
  },
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
