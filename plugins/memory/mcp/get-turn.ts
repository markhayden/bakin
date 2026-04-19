/**
 * bakin_exec_memory_get_turn — fetch a single turn by id.
 *
 * Turn ids are prefixed `turn:<16-hex>`, generated from
 * sha256(agent|sessionId|eventId). Agents that saw a search result already
 * have the id; this tool exists so they can re-fetch the full content
 * (which the search response may have truncated into `snippet`).
 */
import { z } from 'zod'
import type { ExecToolDefinition, PluginContext } from '../../../src/lib/plugin-types'

function parseMeta(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createMemoryGetTurnTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_get_turn',
    label: 'Read turn memory',
    description: 'Fetch a single turn by id (the `turn:<hex>` form).',
    parameters: {
      turnId: z.string().describe('Turn id (required, e.g. turn:abc123...)'),
    },
    handler: async (params: Record<string, unknown>) => {
      const turnId = typeof params.turnId === 'string' ? params.turnId.trim() : ''
      if (!turnId) return { ok: false, error: 'turnId required' }
      if (!turnId.startsWith('turn:')) {
        return { ok: false, error: 'turnId must start with "turn:"' }
      }

      const res = await ctx.search.query({
        q: turnId,
        filters: { tier: 'turn' },
        limit: 50,
        offset: 0,
        rerank: false,
      })
      const match = res.results.find((r) => r.id === turnId)
      if (!match) return { ok: false, error: 'turn not found' }

      return {
        ok: true,
        turn: {
          id: match.id,
          agent: match.fields.agent,
          title: match.fields.title ?? '',
          content: match.fields.content ?? '',
          updatedAt: match.fields.updated_at,
          meta: parseMeta(match.fields.meta),
        },
      }
    },
  }
}
