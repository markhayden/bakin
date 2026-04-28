/**
 * Daily-notes tier routes.
 *
 *   GET  /daily-notes?agent=<id>           → list (sorted by date desc)
 *   GET  /daily-notes/:agent/:filename     → render one note
 *   POST /daily-notes/compare-search       → { search, runtime } side-by-side
 *
 * The compare-search endpoint surfaces both Bakin's search index and the
 * active runtime's own memory search in one response so the UI can compare
 * substrate behavior without naming provider internals.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'
import { getRuntimeMemoryEntry, listRuntimeMemoryEntries } from '../runtime-memory'

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/

// ─── List ─────────────────────────────────────────────────────────────────

export const dailyNotesListRoute: APIRoute = {
  path: '/daily-notes',
  method: 'GET',
  description: 'List daily notes for an agent (sorted by date desc)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })

    const files = (await listRuntimeMemoryEntries(ctx, 'daily_note', agent))
      .map((entry) => entry.path?.split('/').pop() ?? entry.id)
      .map((name) => {
        const m = DATE_PREFIX_RE.exec(name)
        return m ? { name, date: m[1] } : null
      })
      .filter((f): f is { name: string; date: string } => f !== null)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    return Response.json({ files })
  },
}

// ─── Detail ───────────────────────────────────────────────────────────────

export const dailyNotesDetailRoute: APIRoute = {
  path: '/daily-notes/:agent/:filename',
  method: 'GET',
  description: 'Read one daily note',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const filename = url.searchParams.get('filename')
    if (!agent || !filename) return Response.json({ error: 'agent and filename required' }, { status: 400 })

    const entry = await getRuntimeMemoryEntry(ctx, 'daily_note', filename, agent)
    if (!entry) return Response.json({ error: 'not found' }, { status: 404 })

    return Response.json({ agent, file: filename, content: entry.content })
  },
}

// ─── Compare search ───────────────────────────────────────────────────────

interface CompareSearchBody {
  query?: unknown
  agent?: unknown
  limit?: unknown
}

export const dailyNotesCompareSearchRoute: APIRoute = {
  path: '/daily-notes/compare-search',
  method: 'POST',
  description: 'Run the same query against Bakin search and runtime memory search',
  handler: async (req: Request, ctx: PluginContext) => {
    let body: CompareSearchBody
    try {
      body = (await req.json()) as CompareSearchBody
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    }

    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) return Response.json({ error: 'query required' }, { status: 400 })

    const agent = typeof body.agent === 'string' && body.agent.length > 0 ? body.agent : undefined
    const limit = typeof body.limit === 'number' ? body.limit : 20

    // ── Bakin search side ──
    const filters: Record<string, string> = { tier: 'daily_note' }
    if (agent) filters.agent = agent
    const searchParams: SearchQueryParams = { q: query, limit, filters }
    const searchRes = await ctx.search.query(searchParams)
    const search = searchRes.results.map((r) => ({ id: r.id, score: r.score, ...r.fields }))

    // ── Runtime memory side ──
    let runtime: unknown[] = []
    let runtimeStatus: 'ok' | 'no_index_or_no_match' | 'error' = 'ok'
    let runtimeError: string | undefined
    try {
      const cliRes = await ctx.runtime.memory.search(query, { agentId: agent, limit })
      const hits = cliRes.results ?? []
      if (hits.length === 0) {
        runtimeStatus = 'no_index_or_no_match'
      } else {
        runtime = hits
      }
    } catch (err) {
      runtimeStatus = 'error'
      runtimeError = err instanceof Error ? err.message : String(err)
    }

    return Response.json({ search, runtime, runtimeStatus, runtimeError })
  },
}
