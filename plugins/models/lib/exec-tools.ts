/**
 * Models plugin MCP exec tools.
 *
 * Extracted from index.ts. `registerModelsExecTools` registers the two
 * read-only agent-facing tools (list available models, read model config)
 * against the plugin context. Tool names and result shapes are agent-facing
 * contracts — bodies moved verbatim.
 */
import { z } from 'zod'

import type { PluginContext } from '@bakin/core/plugin-types'

import { resolveAgents } from './config-io'
import { fetchAvailableModels } from './available-models'

export function registerModelsExecTools(ctx: PluginContext): void {
  ctx.registerExecTool({
    name: 'bakin_exec_models_list',
    label: 'Listed models',
    description: 'List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.',
    parameters: {
      tier: z.enum(['budget', 'standard', 'premium']).optional().describe('Filter by model tier'),
    },
    handler: async (params: Record<string, unknown>) => {
      try {
        const result = await fetchAvailableModels(ctx as unknown as PluginContext)
        const tier = params.tier as string | undefined
        const models = tier ? result.models.filter((m) => m.tier === tier) : result.models
        return { ok: true, models, cached: result.cached }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  ctx.registerExecTool({
    name: 'bakin_exec_models_get_config',
    label: 'Read model config',
    description: 'Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults.',
    parameters: {
      agentId: z.string().optional().describe('Specific agent ID to query (omit for all agents)'),
    },
    handler: async (params: Record<string, unknown>) => {
      try {
        const agents = await resolveAgents(ctx as unknown as PluginContext)
        const agentId = params.agentId as string | undefined
        if (agentId) {
          const agent = agents.find((a) => a.agentId === agentId)
          if (!agent) return { ok: false, error: `Agent "${agentId}" not found` }
          return { ok: true, agent }
        }
        return { ok: true, agents }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}
