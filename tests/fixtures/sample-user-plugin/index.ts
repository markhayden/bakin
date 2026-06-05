/**
 * Sample user plugin — server entry (fixture for #147 TE14).
 *
 * This is deliberately minimal: no routes, no hooks, no state. The
 * smoke test only cares that buildUserPlugin produces dist/ artifacts
 * with browser externals held and server SDK imports bundled. The server
 * entry imports /metadata (lean, dependency-free — in-process test builds
 * can't read heavier graphs under the harness); client-only subpaths
 * (slots/components/ui/hooks) retain runtime react and are rejected by
 * the externals guard. Root-barrel server-safety is pinned in
 * tests/core/whiskit/build.test.ts.
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
