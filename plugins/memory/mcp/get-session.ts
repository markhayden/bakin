/**
 * bakin_exec_memory_get_session — fetch a session by key + its most recent turns.
 *
 * Two queries against bakin_memory: one for the session row (tier=session,
 * agent optional, sessionKey as q-string), one for turns
 * (tier=turn, sessionKey in q-string, ordered by recency). Returns parsed
 * meta so agents don't have to JSON.parse on the way out.
 */
import { z } from 'zod'
import type { ExecToolDefinition, PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

function parseMeta(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createMemoryGetSessionTool(ctx: PluginContext): ExecToolDefinition {
  return {
    name: 'bakin_exec_memory_get_session',
    label: 'Read session memory',
    description: 'Fetch a session by key plus its most recent turns.',
    parameters: {
      sessionKey: z.string().describe('Session key (required)'),
      agent: z.string().optional().describe('Narrow to a single agent'),
      turnLimit: z.number().int().positive().max(500).optional().describe('Max turns to include (default 50)'),
    },
    handler: async (params: Record<string, unknown>) => {
      const sessionKey = typeof params.sessionKey === 'string' ? params.sessionKey.trim() : ''
      if (!sessionKey) return { ok: false, error: 'sessionKey required' }

      const agent = typeof params.agent === 'string' ? params.agent : undefined
      const turnLimit = typeof params.turnLimit === 'number'
        ? Math.min(500, Math.max(1, Math.floor(params.turnLimit)))
        : 50

      const sessionFilters: Record<string, string> = { tier: 'session' }
      if (agent) sessionFilters.agent = agent

      const sessionQ: SearchQueryParams = {
        q: sessionKey,
        filters: sessionFilters,
        limit: 20,
        offset: 0,
        rerank: false,
      }
      const sessionRes = await ctx.search.query(sessionQ)
      const sessionMatch = sessionRes.results.find((r) => {
        const m = parseMeta(r.fields.meta)
        return m?.sessionKey === sessionKey
      })
      if (!sessionMatch) return { ok: false, error: 'session not found' }

      const session = {
        id: sessionMatch.id,
        tier: sessionMatch.fields.tier,
        agent: sessionMatch.fields.agent,
        title: sessionMatch.fields.title ?? '',
        updatedAt: sessionMatch.fields.updated_at,
        meta: parseMeta(sessionMatch.fields.meta),
      }

      const turnFilters: Record<string, string> = { tier: 'turn' }
      if (agent) turnFilters.agent = agent
      const turnsRes = await ctx.search.query({
        q: sessionKey,
        filters: turnFilters,
        limit: turnLimit,
        offset: 0,
        rerank: false,
      })
      const turns = turnsRes.results
        .filter((r) => {
          const m = parseMeta(r.fields.meta)
          return m?.sessionKey === sessionKey
        })
        .map((r) => ({
          id: r.id,
          agent: r.fields.agent,
          title: r.fields.title ?? '',
          snippet: r.fields.snippet ?? '',
          updatedAt: r.fields.updated_at,
          meta: parseMeta(r.fields.meta),
        }))

      return { ok: true, session, turns }
    },
  }
}
