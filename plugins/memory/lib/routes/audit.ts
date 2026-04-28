/**
 * GET /audit — audit tier browser.
 *
 * Thin wrapper around `ctx.search.query` that scopes results to
 * tier='audit' and maps URL query params to filters. Result shape is
 * `{ entries, total }` so the UI doesn't have to learn search hit shape.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export const auditRoute: APIRoute = {
  path: '/audit',
  method: 'GET',
  description: 'List indexed audit entries with optional filters',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent') ?? undefined
    const event = url.searchParams.get('event') ?? undefined
    const q = url.searchParams.get('q') ?? ''
    const limitRaw = url.searchParams.get('limit')

    let limit = DEFAULT_LIMIT
    if (limitRaw !== null) {
      const parsed = Number(limitRaw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return Response.json({ error: 'invalid limit' }, { status: 400 })
      }
      limit = Math.min(Math.floor(parsed), MAX_LIMIT)
    }

    const filters: Record<string, string> = { tier: 'audit' }
    if (agent) filters.agent = agent

    const qText = [q, event].filter(Boolean).join(' ')

    const params: SearchQueryParams = {
      q: qText,
      limit,
      filters,
    }

    const result = await ctx.search.query(params)
    return Response.json({
      entries: result.results.map((r) => ({ id: r.id, score: r.score, ...r.fields })),
      total: result.meta.total ?? result.results.length,
    })
  },
}
