/**
 * Sample user plugin — server entry (fixture for #147 TE14).
 *
 * This is deliberately minimal: no routes, no hooks, no state. The
 * smoke test only cares that buildUserPlugin produces dist/ artifacts
 * with browser externals held and server SDK imports bundled. The server
 * entry exports the supported /types runtime constant; client-only subpaths retain
 * runtime React and are rejected by the server externals guard. Root-barrel
 * server-safety is pinned in tests/core/whiskit/build.test.ts.
 */
import { HEALTH_INCIDENT_CLASSES } from '@makinbakin/sdk/types'

export const incidentClasses = HEALTH_INCIDENT_CLASSES

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
  },
}

export default plugin
