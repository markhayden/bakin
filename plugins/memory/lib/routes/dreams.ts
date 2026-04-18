/**
 * Dream tier routes.
 *
 *   GET /dreams?agent=<id>[&phase=<p>][&date=<YYYY-MM-DD>][&artifactType=<t>]
 *                        [&limit=<n>&offset=<n>]
 *         → list dream artifacts for an agent (phase/date filters apply
 *           post-query on parsed meta).
 *   GET /dreams/:agent/:artifactType?[phase=&date=]
 *         → one dream artifact detail. `phase_doc` needs both; `session_corpus`
 *           needs `date`; the other artifact types are identified by
 *           artifactType alone.
 *
 * Both endpoints read from the `bakin_memory` table (tier=dream). The indexer
 * is the single source of truth — routes never re-parse files.
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

function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─── List dreams ─────────────────────────────────────────────────────────

export const dreamsListRoute: APIRoute = {
  path: '/dreams',
  method: 'GET',
  description: 'List dream artifacts for an agent (optional phase/date/artifactType filters)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })
    const phase = url.searchParams.get('phase')
    const date = url.searchParams.get('date')
    const artifactType = url.searchParams.get('artifactType')
    const { limit, offset } = parseLimitOffset(url)

    const qTerms = [phase, date, artifactType].filter((x): x is string => !!x)
    const params: SearchQueryParams = {
      q: qTerms.join(' '),
      filters: { tier: 'dream', agent },
      limit,
      offset,
      rerank: false,
    }
    const res = await ctx.search.query(params)

    const filtered = res.results.filter((r) => {
      if (!phase && !date && !artifactType) return true
      const m = parseMeta(r.fields?.meta)
      if (!m) return false
      if (phase && m.phase !== phase) return false
      if (date && m.date !== date) return false
      if (artifactType && m.artifactType !== artifactType) return false
      return true
    })

    const dreams = filtered.map((r) => ({ id: r.id, score: r.score, ...r.fields }))
    return Response.json({ dreams, total: filtered.length })
  },
}

// ─── Dream detail ────────────────────────────────────────────────────────

export const dreamDetailRoute: APIRoute = {
  path: '/dreams/:agent/:artifactType',
  method: 'GET',
  description: 'Read one dream artifact by (agent, artifactType[, phase, date])',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const artifactType = url.searchParams.get('artifactType')
    if (!agent || !artifactType) {
      return Response.json(
        { error: 'agent and artifactType required' },
        { status: 400 },
      )
    }
    const phase = url.searchParams.get('phase')
    const date = url.searchParams.get('date')

    const qTerms = [artifactType, phase, date].filter((x): x is string => !!x)
    const params: SearchQueryParams = {
      q: qTerms.join(' '),
      filters: { tier: 'dream', agent },
      limit: 50,
      offset: 0,
      rerank: false,
    }
    const res = await ctx.search.query(params)
    const match = res.results.find((r) => {
      const m = parseMeta(r.fields?.meta)
      if (!m) return false
      if (m.artifactType !== artifactType) return false
      if (phase && m.phase !== phase) return false
      if (date && m.date !== date) return false
      return true
    })
    if (!match) return Response.json({ error: 'not found' }, { status: 404 })
    return Response.json({ id: match.id, ...match.fields })
  },
}
