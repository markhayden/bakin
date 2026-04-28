/**
 * bakin_exec_memory_list_agents — list agents with per-tier row counts.
 *
 * Asks search for agent + tier aggregations in one query. Rather than
 * returning a flat count-by-agent list, we pivot so callers can see
 * {agent, total, byTier: { session, turn, ... }} — the common shape for
 * "pick an agent, scope to a tier, search."
 */
import type { ExecToolDefinition, PluginContext } from '@bakin/core/plugin-types'
import { MEMORY_TIERS, type MemoryTier } from '../lib/types'

type ByTier = Record<MemoryTier, number>

function emptyByTier(): ByTier {
  return Object.fromEntries(MEMORY_TIERS.map((t) => [t, 0])) as ByTier
}

export function createMemoryListAgentsTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_list_agents',
    label: 'Listed memory agents',
    description: 'Agents with memory rows, each with total count and per-tier breakdown.',
    parameters: {},
    handler: async () => {
      const perTier = new Map<string, ByTier>()

      await Promise.all(
        MEMORY_TIERS.map(async (tier) => {
          try {
            const res = await ctx.search.query({
              q: '',
              filters: { tier },
              limit: 0,
              offset: 0,
              rerank: false,
              facets: ['agent'],
            })
            const agg = res.aggregations?.agent ?? []
            for (const { value, count } of agg) {
              const bucket = perTier.get(value) ?? emptyByTier()
              bucket[tier] = count
              perTier.set(value, bucket)
            }
          } catch {
            // Per-tier failure degrades gracefully — just no counts for that tier.
          }
        }),
      )

      const agents = Array.from(perTier.entries())
        .map(([agent, byTier]) => {
          const total = Object.values(byTier).reduce((s, n) => s + n, 0)
          return { agent, total, byTier }
        })
        .sort((a, b) => b.total - a.total)

      return { ok: true, agents }
    },
  }
}
