import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import { storyGlobsForAudience, type StorybookAudience } from './audiences.ts'

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))
const teamRoot = fileURLToPath(new URL('../plugins/team', import.meta.url))
const workflowsRoot = fileURLToPath(new URL('../plugins/workflows', import.meta.url))
const audience: StorybookAudience = process.env.BAKIN_STORYBOOK_AUDIENCE === 'public'
  ? 'public'
  : 'maintainer'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: storyGlobsForAudience(audience),
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
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
          '@bakin/team': teamRoot,
          // The SDK hooks barrel re-exports the workflows notification-channel
          // hook for Bits; Bun resolves @bakin/* via tsconfig paths, Vite needs
          // the alias spelled out (same story as @bakin/team above).
          '@bakin/workflows': workflowsRoot,
        },
      },
    })
  },
}

export default config
