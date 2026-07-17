/**
 * Models plugin — server entry point.
 * API routes for model config, available models, aliases, and defaults.
 *
 * Thin definePlugin shell: the route array lives in lib/routes.ts, the
 * cross-plugin hooks in lib/register-hooks.ts, the exec tools in
 * lib/exec-tools.ts, and the config/cache/alias machinery in
 * lib/{config-io,available-models,aliases,model-id,route-schemas}.ts.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'

import { modelsRoutes } from './lib/routes'
import { registerModelsHooks } from './lib/register-hooks'
import { registerModelsExecTools } from './lib/exec-tools'
import { isLegacyBudget, migrateLegacyBudget } from './lib/budget-migration'
import { isLegacyRouting, migrateLegacyRouting } from './lib/routing-migration'
import type { ModelsPluginSettings } from './types'

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const modelsPlugin: BakinPlugin = definePlugin({
  id: 'models',
  name: 'Models',
  version: '2.1.0',
  routes: modelsRoutes,

  settingsSchema: {
    fields: [
      { key: 'defaultModel', type: 'select', label: 'Default model', description: 'Default model for new agents', options: [{ value: 'openai-codex/gpt-5.4', label: 'GPT-5.4' }, { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6' }], default: 'openai-codex/gpt-5.4' },
    ],
  },

  // Nav items registered in client.tsx (order: 70) — no server-side duplication

  activate(ctx: PluginContext) {
    // One-shot budget-shape migration (PR #500 {global, perAgent} → v2 rule
    // list). Runs before hooks register so models.getBudgetPolicy never
    // serves the legacy shape.
    const budget = ctx.getSettings<ModelsPluginSettings>().budget
    if (isLegacyBudget(budget)) {
      ctx.updateSettings({ budget: migrateLegacyBudget(budget) })
    }

    // One-shot routing-shape migration (origin policies → work-class routes).
    // Same discipline: runs before hooks register so models.getRoutingConfig
    // never serves the legacy shape.
    const routing = ctx.getSettings<ModelsPluginSettings>().routing
    if (isLegacyRouting(routing)) {
      ctx.updateSettings({ routing: migrateLegacyRouting(routing) })
    }

    // Hooks — cross-plugin communication
    registerModelsHooks(ctx)

    // MCP Exec Tools — read-only agent access
    registerModelsExecTools(ctx)
  },
})

export default modelsPlugin
