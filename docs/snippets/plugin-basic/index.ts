import { definePlugin, defineRoute } from '@makinbakin/sdk/routing'

const plugin = definePlugin({
  id: 'docs-basic',
  name: 'Docs Basic',
  version: '0.1.0',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Say hello',
      description: 'Returns a small JSON payload from the docs example plugin.',
      visibility: 'public',
      stability: 'stable',
      handler: async () => Response.json({ message: 'Hello from Bakin' }),
    }),
  ],
  async activate() {},
})

export default plugin
