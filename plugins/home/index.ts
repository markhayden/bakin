/**
 * Home plugin — server entry point.
 * The page Bakin opens on. What it shows is derived from the home's real
 * state; the only things stored are decisions a person made.
 * Deep reference: `.claude/knowledge/home.md`.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'

const log = createLogger('home')

const homePlugin: BakinPlugin = definePlugin({
  id: 'home',
  name: 'Home',
  version: '0.1.0',
  routes: [],

  async activate() {
    log.info('Home plugin activated')
  },
})

export default homePlugin
