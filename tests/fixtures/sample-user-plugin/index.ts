/**
 * Sample user plugin — server entry (fixture for #147 TE14).
 *
 * This is deliberately minimal: no routes, no hooks, no state. The
 * smoke test only cares that buildUserPlugin produces dist/ artifacts
 * with browser externals held and server SDK imports bundled. The server
 * entry imports a server-safe SDK subpath (metadata) — react-touching subpaths
 * (slots/components/ui/hooks) and the SDK root retain runtime react imports
 * and are rejected by the whiskit server-bundle externals guard.
 */
import { defineHookContract } from '@makinbakin/sdk/metadata'

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
    void defineHookContract
  },
}

export default plugin
