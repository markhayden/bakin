/**
 * Explore plugin — server entry point.
 * Curated-catalog discovery: browse and install official agents, plugins,
 * and packs. Discovery only — lifecycle management stays in Team/Health.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'

const log = createLogger('explore')

const explorePlugin: BakinPlugin = definePlugin({
  id: 'explore',
  name: 'Explore',
  version: '1.0.0',
  routes: [],

  async activate() {
    log.info('Explore plugin activated')
  },
}) as unknown as BakinPlugin

export default explorePlugin
