/**
 * bakin_exec_memory_search — hybrid search over the unified bakin_memory table.
 *
 * Thin wrapper around ctx.search.query with tier/agent filters exposed as
 * structured args. Returns the shape specified in the rebuild spec §Feature 10
 * so agents can consume results without having to understand the indexed
 * row shape.
 */
import { z } from 'zod'
import type { ExecToolDefinition, PluginContext, SearchQueryParams } from '../../../src/lib/plugin-types'
import { MemoryTierSchema } from '../lib/types'

function parseMeta(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createMemorySearchTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_search',
    label: 'Searched memory',
    description:
      'Hybrid search across every memory tier (sessions, turns, checkpoints, daily notes, dreams, durable, audit). Optional tier/agent filters.',
    parameters: {
      query: z.string().describe('Search query (required)'),
      tier: MemoryTierSchema.optional().describe('Filter to a single tier'),
      agent: z.string().optional().describe('Filter to a single agent id'),
      limit: z.number().int().positive().max(100).optional().describe('Max results (default 20, max 100)'),
    },
    handler: async (params: Record<string, unknown>) => {
      const query = typeof params.query === 'string' ? params.query.trim() : ''
      if (!query) return { ok: false, error: 'query required' }

      const filters: Record<string, string> = {}
      if (typeof params.tier === 'string') filters.tier = params.tier
      if (typeof params.agent === 'string') filters.agent = params.agent

      const limit = typeof params.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(params.limit))) : 20

      const qp: SearchQueryParams = {
        q: query,
        filters: Object.keys(filters).length ? filters : undefined,
        limit,
        offset: 0,
        rerank: false,
      }

      try {
        const res = await ctx.search.query(qp)
        const results = res.results.map((r) => ({
          id: r.id,
          tier: r.fields.tier,
          agent: r.fields.agent,
          title: r.fields.title ?? '',
          snippet: r.fields.snippet ?? '',
          score: r.score,
          sourceRef: {
            backend: r.fields.source_backend,
            path: r.fields.source_path,
          },
          updatedAt: r.fields.updated_at,
          meta: parseMeta(r.fields.meta),
        }))
        return { ok: true, total: res.meta?.total ?? results.length, results }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
