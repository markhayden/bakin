import type { BakinConfig } from '@bakin/core/plugin-types'

const config: BakinConfig = {
  plugins: [
    { path: 'plugins/team' },
    { path: 'plugins/tasks' },
    { path: 'plugins/memory' },
    { path: 'plugins/models' },
    { path: 'plugins/assets' },
    { path: 'plugins/images' },
    { path: 'plugins/brands' },
    { path: 'plugins/workflows' },
    { path: 'plugins/schedule' },
    { path: 'plugins/health' },
    { path: 'plugins/git' },
    { path: 'plugins/explore' },
    { path: 'plugins/chat' },
  ],
  theme: {},
}

export default config
