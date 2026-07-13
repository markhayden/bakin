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
import { registerBrandExecTools } from './lib/exec-tools'
import { registerBrandsSearch } from './lib/search-sync'
import { checkBrandsIntegrity } from './lib/health-checks'

const log = createLogger('brands')

const brandsPlugin: BakinPlugin = definePlugin({
  id: 'brands',
  name: 'Brands',
  version: '1.0.0',
  routes: brandRoutes,

  settingsSchema: {
    fields: [
      {
        key: 'warnUnbranded',
        type: 'boolean' as const,
        label: 'Warn on unbranded tasks',
        description:
          'Adds a subtle "no brand" badge to board cards without a brand (their output has no brand guardrails). Visibility only — nothing blocks.',
        default: false,
      },
    ],
  },

  async activate(ctx: PluginContext) {
    registerBrandsHooks(ctx)
    registerBrandExecTools(ctx)
    registerBrandsSearch(ctx)

    ctx.registerHealthCheck({
      id: 'integrity',
      name: 'Brand integrity (dangling refs, ghost-brand tasks, drafts)',
      description: 'Checks brand manifests, asset references, drafts, and tasks blocked by missing brands.',
      group: { key: 'brands', label: 'Brands' },
      run: () => checkBrandsIntegrity(ctx),
    })

    log.info('Brands plugin activated')
  },
})

export default brandsPlugin
