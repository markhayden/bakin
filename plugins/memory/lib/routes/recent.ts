/**
 * GET /recent — cross-tier "recent activity" feed for the memory landing page.
 *
 *   GET /recent?limit=30&tier=session,checkpoint&agent=patch,scout&debug=1
 *
 * Turns and audits are excluded by default:
 *   - turns  — 12k+ rows of per-message detail drown out every other tier
 *   - audits — operational event stream (task.created, task.updated), useful
 *              for debugging why a thing happened but not for understanding
 *              what memory contains.
 *
 * Pass `?debug=1` to include both (wired to the /memory page-local debug
 * toggle — distinct from the global useDebug() which controls dev-time
 * affordances like score overlays) or `?tier=turn` / `?tier=audit` to
 * include them via an explicit filter chip — the route treats any explicit
 * tier list as an override of the debug-hidden defaults.
 *
 * Antfly has no native sort-by-field, so we fan out per-tier with a generous
 * overshoot (`OVERSHOOT_PER_TIER`) using the match-all / full-text-only
 * strategy, then merge and sort by `updated_at` desc client-side before
 * trimming to the requested limit. The response shape matches SearchResponse
 * (`results`, `aggregations`, `meta`) so the client can reuse `useSearch`'s
 * result renderer without a second type.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'
import { MEMORY_TIERS, type MemoryTier } from '../types'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
// Pulled per tier before the merge+sort. Needs to cover the most recent
// window even when BM25 on `q: '*'` returns results in arbitrary order.
const OVERSHOOT_PER_TIER = 100

const DEBUG_ONLY_TIERS: ReadonlySet<MemoryTier> = new Set(['turn', 'audit'])

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN
  return Math.min(Math.floor(parsed), MAX_LIMIT)
}

function parseCsv(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function resolveTiers(requested: string[], debug: boolean): MemoryTier[] {
  if (requested.length > 0) {
    return requested.filter((t): t is MemoryTier =>
      (MEMORY_TIERS as readonly string[]).includes(t),
    )
  }
  if (debug) return [...MEMORY_TIERS]
  return MEMORY_TIERS.filter((t) => !DEBUG_ONLY_TIERS.has(t))
}

function parseBool(raw: string | null): boolean {
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true'
}

function tsOf(fields: Record<string, unknown>): number {
  const v = fields.updated_at
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export const recentRoute: APIRoute = {
  path: '/recent',
  method: 'GET',
  description: 'Recent memory items across tiers, sorted by updated_at desc',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'))
    if (Number.isNaN(limit)) {
      return Response.json({ error: 'invalid limit' }, { status: 400 })
    }

    const debug = parseBool(url.searchParams.get('debug'))
    const tiers = resolveTiers(parseCsv(url.searchParams.get('tier')), debug)
    if (tiers.length === 0) {
      return Response.json({
        results: [],
        aggregations: {},
        meta: { query: '', total: 0, took_ms: 0, source: 'antfly' },
      })
    }

    const agents = parseCsv(url.searchParams.get('agent'))

    const started = Date.now()

    // One query per tier × agent. When no agent filter is set, the inner
    // agents array collapses to a single [undefined] pass. With filters we
    // fan out so each tier/agent pair gets its own overshoot window —
    // otherwise a chatty agent would crowd out quieter ones.
    const agentBuckets = agents.length ? agents : [undefined]

    const perQueryResults = await Promise.all(
      tiers.flatMap((tier) =>
        agentBuckets.map(async (agent) => {
          const filters: Record<string, string> = { tier }
          if (agent) filters.agent = agent
          const params: SearchQueryParams = {
            q: '*',
            filters,
            limit: OVERSHOOT_PER_TIER,
            offset: 0,
            rerank: false,
            strategy: 'full_text_only',
          }
          try {
            const res = await ctx.search.query(params)
            return res.results
          } catch {
            return []
          }
        }),
      ),
    )

    const merged = perQueryResults.flat()
    merged.sort((a, b) => tsOf(b.fields) - tsOf(a.fields))
    const trimmed = merged.slice(0, limit)

    return Response.json({
      results: trimmed,
      aggregations: {},
      meta: {
        query: '',
        total: merged.length,
        took_ms: Date.now() - started,
        source: 'antfly',
      },
    })
  },
}
