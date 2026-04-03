import type { BakinConfig } from './src/lib/plugin-types'

const config: BakinConfig = {
  plugins: [
    { path: 'plugins/team' },
    { path: 'plugins/tasks' },
    { path: 'plugins/memory' },
    { path: 'plugins/models' },
    { path: 'plugins/calendar' },
    { path: 'plugins/workflows' },
    { path: 'plugins/assets' },
    { path: 'plugins/schedule' },
    { path: 'plugins/projects' },
  ],
  theme: {},
}

export default config
