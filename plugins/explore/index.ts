/**
 * Explore plugin — server entry point.
 * Curated-catalog discovery: browse and install official agents, plugins,
 * and packs. Discovery only — lifecycle management stays in Team/Health.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { mergedCatalog } from './lib/catalog'
import { gatherInstallSources, joinInstallState } from './lib/install-state'
import type { ExploreCatalogResponse } from './types'

const log = createLogger('explore')

const routes = [
  defineRoute({
    path: '/catalog',
    method: 'GET',
    summary: 'Merged curated catalog with install state',
    description:
      'Embedded catalog merged with the cached remote catalog, joined against local lockfiles. No network I/O.',
    handler: async () => {
      try {
        const catalog = await mergedCatalog()
        const entries = joinInstallState(catalog.entries, gatherInstallSources())
        const body: ExploreCatalogResponse = {
          ok: true,
          updatedAt: catalog.updatedAt,
          remoteUpdatedAt: catalog.remoteUpdatedAt,
          entries,
        }
        return Response.json(body)
      } catch (err) {
        log.error('catalog route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        )
      }
    },
  }),
]

const explorePlugin: BakinPlugin = definePlugin({
  id: 'explore',
  name: 'Explore',
  version: '1.0.0',
  routes,

  async activate() {
    log.info('Explore plugin activated')
  },
}) as unknown as BakinPlugin

export default explorePlugin
