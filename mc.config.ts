import type { MCConfig } from './src/lib/plugin-types'

const config: MCConfig = {
  plugins: [
    { path: 'plugins/tasks' },
    { path: 'plugins/memory' },
    { path: 'plugins/models' },
    { path: 'plugins/calendar' },
    { path: 'plugins/workflows' },
    { path: 'plugins/assets' },
  ],
  theme: {},
}

export default config
