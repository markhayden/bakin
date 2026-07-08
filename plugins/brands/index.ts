/**
 * Brands plugin (#419) — structured brand definitions linkable to tasks,
 * projects, and generation.
 *
 * A brand is a directory under ~/.bakin/brands/<id>/: a zod manifest for
 * what machines read (palette, rules, asset refs) and freeform markdown for
 * what agents read (guidelines, lessons). Dispatch injects a byte-budgeted
 * brand card per task via the brands.getContext hook; depth is pull-based
 * through exec tools. Deep reference: .claude/knowledge/brands-plugin.md.
 */
import { definePlugin } from '@bakin/core/routing'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { createLogger } from '../../src/core/logger'
import { brandRoutes } from './lib/routes'
import { registerBrandsHooks } from './lib/register-hooks'

const log = createLogger('brands')

const brandsPlugin: BakinPlugin = definePlugin({
  id: 'brands',
  name: 'Brands',
  version: '1.0.0',
  routes: brandRoutes,

  async activate(ctx: PluginContext) {
    registerBrandsHooks(ctx)
    log.info('Brands plugin activated')
  },
}) as unknown as BakinPlugin

export default brandsPlugin
