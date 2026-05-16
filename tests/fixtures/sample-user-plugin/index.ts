/**
 * Sample user plugin — server entry (fixture for #147 TE14).
 *
 * This is deliberately minimal: no routes, no hooks, no state. The
 * smoke test only cares that buildUserPlugin produces dist/ artifacts
 * with browser externals held and server SDK imports bundled.
 */
import { registerSlot } from '@makinbakin/sdk/slots'

interface PluginLike {
  id: string
  name: string
  version: string
  activate: () => Promise<void>
}

const plugin: PluginLike = {
  id: 'sample',
  name: 'Sample',
  version: '0.1.0',
  async activate() {
    void registerSlot
  },
}

export default plugin
