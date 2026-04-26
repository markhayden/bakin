import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'

const plugin: BakinPlugin = {
  id: 'docs-basic',
  name: 'Docs Basic',
  version: '0.1.0',
  async activate(ctx: PluginContext) {
    ctx.registerRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Say hello',
      description: 'Returns a small JSON payload from the docs example plugin.',
      visibility: 'public',
      stability: 'stable',
      handler: async () => Response.json({ message: 'Hello from Bakin' }),
    })
  },
}

export default plugin
