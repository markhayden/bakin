import type { BakinConfig } from '@bakin/core/plugin-types'

const config: BakinConfig = {
  plugins: [
    { path: 'plugins/team' },
    { path: 'plugins/tasks' },
    { path: 'plugins/memory' },
    { path: 'plugins/models' },
    { path: 'plugins/workflows' },
    { path: 'plugins/assets' },
    { path: 'plugins/schedule' },
    { path: 'plugins/health' },
    { path: 'plugins/git' },
  ],
  theme: {},
}

export default config
