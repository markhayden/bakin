/**
 * Checkpoint tier routes.
 *
 *   GET /checkpoints?agent=<id>[&sessionId=<id>][&limit=<n>&offset=<n>]
 *         → list compaction checkpoints for an agent (optionally scoped
 *           to one session), search-backed.
 *   GET /checkpoints/:agent/:sessionId/:checkpointId
 *         → one checkpoint detail.
 *
 * Both endpoints read from the `bakin_memory` table (tier=checkpoint). The
 * indexer is the single source of truth — routes never re-parse files.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'

function parseLimitOffset(url: URL): { limit: number; offset: number } {
  const l = Number(url.searchParams.get('limit'))
  const o = Number(url.searchParams.get('offset'))
  return {
    limit: Number.isFinite(l) && l > 0 && l <= 500 ? Math.floor(l) : 100,
    offset: Number.isFinite(o) && o >= 0 ? Math.floor(o) : 0,
  }
}

// ─── List checkpoints ────────────────────────────────────────────────────

export const checkpointsListRoute: APIRoute = {
  path: '/checkpoints',
  method: 'GET',
  description: 'List compaction checkpoints for an agent (optionally by session)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })
    const sessionId = url.searchParams.get('sessionId')
    const { limit, offset } = parseLimitOffset(url)

    const params: SearchQueryParams = {
      q: sessionId ?? '',
      filters: { tier: 'checkpoint', agent },
      limit,
      offset,
      rerank: false,
    }
    const res = await ctx.search.query(params)
    const checkpoints = res.results.map((r) => ({ id: r.id, score: r.score, ...r.fields }))
    return Response.json({ checkpoints, total: res.meta.total })
  },
}

// ─── Checkpoint detail ───────────────────────────────────────────────────

export const checkpointDetailRoute: APIRoute = {
  path: '/checkpoints/:agent/:sessionId/:checkpointId',
  method: 'GET',
  description: 'Read one checkpoint by (agent, sessionId, checkpointId)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const sessionId = url.searchParams.get('sessionId')
    const checkpointId = url.searchParams.get('checkpointId')
    if (!agent || !sessionId || !checkpointId) {
      return Response.json(
        { error: 'agent, sessionId, and checkpointId required' },
        { status: 400 },
      )
    }

    const params: SearchQueryParams = {
      q: `${sessionId} ${checkpointId}`,
      filters: { tier: 'checkpoint', agent },
      limit: 20,
      offset: 0,
      rerank: false,
    }
    const res = await ctx.search.query(params)
    const match = res.results.find((r) => {
      const raw = r.fields?.meta
      if (typeof raw !== 'string') return false
      try {
        const m = JSON.parse(raw) as Record<string, unknown>
        return m.sessionId === sessionId && m.checkpointId === checkpointId
      } catch {
        return false
      }
    })
    if (!match) return Response.json({ error: 'not found' }, { status: 404 })
    return Response.json({ id: match.id, ...match.fields })
  },
}
