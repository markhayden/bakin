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
    // Hooks — cross-plugin communication
    registerModelsHooks(ctx)

    // MCP Exec Tools — read-only agent access
    registerModelsExecTools(ctx)
  },
}) as unknown as BakinPlugin

export default modelsPlugin
