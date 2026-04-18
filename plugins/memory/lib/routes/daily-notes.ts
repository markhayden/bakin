/**
 * Daily-notes tier routes.
 *
 *   GET  /daily-notes?agent=<id>           → list (sorted by date desc)
 *   GET  /daily-notes/:agent/:filename     → render one note
 *   POST /daily-notes/compare-search       → { antfly, lancedb } side-by-side
 *
 * The compare-search endpoint is the whole point of this tier: OpenClaw
 * already maintains a LanceDB vector index over daily notes, so we surface
 * both substrates in one response so the UI can show a diff.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'
import { listDailyNotes, readDailyNote } from '../openclaw-adapter'
import { memorySearch } from '../openclaw-cli'

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/

// ─── List ─────────────────────────────────────────────────────────────────

export const dailyNotesListRoute: APIRoute = {
  path: '/daily-notes',
  method: 'GET',
  description: 'List daily notes for an agent (sorted by date desc)',
  handler: async (req: Request, _ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })

    const files = listDailyNotes(agent)
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
  handler: async (req: Request, _ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const filename = url.searchParams.get('filename')
    if (!agent || !filename) return Response.json({ error: 'agent and filename required' }, { status: 400 })

    const content = readDailyNote(agent, filename)
    if (content === null) return Response.json({ error: 'not found' }, { status: 404 })

    return Response.json({ agent, file: filename, content })
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
  description: 'Run the same query against Antfly (bakin_memory) and OpenClaw LanceDB',
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

    // ── Antfly side ──
    const filters: Record<string, string> = { tier: 'daily_note' }
    if (agent) filters.agent = agent
    const antflyParams: SearchQueryParams = { q: query, limit, filters }
    const antflyRes = await ctx.search.query(antflyParams)
    const antfly = antflyRes.results.map((r) => ({ id: r.id, score: r.score, ...r.fields }))

    // ── LanceDB side ──
    let lancedb: unknown[] = []
    let lancedbStatus: 'ok' | 'no_index_or_no_match' | 'error' = 'ok'
    let lancedbError: string | undefined
    try {
      const cliRes = await memorySearch(query, { agent, limit })
      const hits = cliRes.results ?? []
      if (hits.length === 0) {
        lancedbStatus = 'no_index_or_no_match'
      } else {
        lancedb = hits
      }
    } catch (err) {
      lancedbStatus = 'error'
      lancedbError = err instanceof Error ? err.message : String(err)
    }

    return Response.json({ antfly, lancedb, lancedbStatus, lancedbError })
  },
}
