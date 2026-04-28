/**
 * Session + turn tier routes.
 *
 *   GET /sessions?agent=<id>[&kind=<main|openai|…>]
 *         → list sessions for an agent (runtime-backed)
 *   GET /sessions/:agent/:sessionKey
 *         → one session's full meta
 *   GET /sessions/:agent/:sessionKey/turns[?limit=<n>&offset=<n>&eventType=<…>]
 *         → turns belonging to one session (search-backed)
 *   GET /turns?agent=<id>&sessionId=<id>[&limit=<n>&offset=<n>&eventType=<…>]
 *         → convenience form of the above for callers that only know sessionId
 *
 * The list/detail endpoints re-read the sessions source at request time so a
 * freshly-connected UI never lags the roster. Turn endpoints go through the
 * indexed `bakin_memory` table — the indexer already enforces the 32 KB
 * truncation / head-only chunking rules, so the route is a pure query.
 */
import type { APIRoute, PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'
import { getRuntimeMemoryEntry } from '../runtime-memory'

type SessionMap = Record<string, unknown>

async function loadSessionMap(ctx: PluginContext, agent: string): Promise<{ map: SessionMap; sourcePath?: string } | null> {
  const entry = await getRuntimeMemoryEntry(ctx, 'session_store', 'sessions.json', agent)
  if (!entry) return null
  try {
    const parsed = JSON.parse(entry.content) as unknown
    const map = extractSessionMap(parsed)
    return map ? { map, sourcePath: entry.path } : null
  } catch {
    return null
  }
}

function extractSessionMap(resp: unknown): SessionMap | null {
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return null
  const r = resp as Record<string, unknown>
  const nested = r.sessions
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as SessionMap
  }
  return r
}

const SESSION_KEY_KIND_RE = /^agent:[^:]+:([^:]+)(?::.*)?$/
function extractKind(key: string): string {
  const m = SESSION_KEY_KIND_RE.exec(key)
  return m ? m[1] : 'unknown'
}

// ─── List sessions ────────────────────────────────────────────────────────

export const sessionsListRoute: APIRoute = {
  path: '/sessions',
  method: 'GET',
  description: 'List sessions for an agent',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    if (!agent) return Response.json({ error: 'agent required' }, { status: 400 })

    const kindFilter = url.searchParams.get('kind')
    const loaded = await loadSessionMap(ctx, agent)
    if (loaded === null) return Response.json({ sessions: [], sourcePath: null })

    const sessions: Array<Record<string, unknown>> = []
    for (const [key, value] of Object.entries(loaded.map)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const kind = extractKind(key)
      if (kindFilter && kind !== kindFilter) continue
      sessions.push({ sessionKey: key, kind, ...(value as Record<string, unknown>) })
    }
    sessions.sort((a, b) => {
      const au = typeof a.updatedAt === 'number' ? a.updatedAt : 0
      const bu = typeof b.updatedAt === 'number' ? b.updatedAt : 0
      return bu - au
    })
    return Response.json({ sessions, sourcePath: loaded.sourcePath ?? null })
  },
}

// ─── Session detail ───────────────────────────────────────────────────────

export const sessionDetailRoute: APIRoute = {
  path: '/sessions/:agent/:sessionKey',
  method: 'GET',
  description: 'Read one session by key',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const sessionKey = url.searchParams.get('sessionKey')
    if (!agent || !sessionKey) {
      return Response.json({ error: 'agent and sessionKey required' }, { status: 400 })
    }
    const loaded = await loadSessionMap(ctx, agent)
    const match = loaded ? loaded.map[sessionKey] : null
    if (!match || typeof match !== 'object') {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    return Response.json({
      agent,
      sessionKey,
      kind: extractKind(sessionKey),
      ...(match as Record<string, unknown>),
    })
  },
}

// ─── Turns for a session ──────────────────────────────────────────────────

function parseLimitOffset(url: URL): { limit: number; offset: number } {
  const l = Number(url.searchParams.get('limit'))
  const o = Number(url.searchParams.get('offset'))
  return {
    limit: Number.isFinite(l) && l > 0 && l <= 500 ? Math.floor(l) : 100,
    offset: Number.isFinite(o) && o >= 0 ? Math.floor(o) : 0,
  }
}

async function queryTurns(
  ctx: PluginContext,
  filters: Record<string, string>,
  limit: number,
  offset: number,
): Promise<Response> {
  const params: SearchQueryParams = {
    q: '',
    filters: { tier: 'turn', ...filters },
    limit,
    offset,
    rerank: false,
  }
  const res = await ctx.search.query(params)
  const turns = res.results.map((r) => ({ id: r.id, score: r.score, ...r.fields }))
  return Response.json({ turns, total: res.meta.total })
}

export const sessionTurnsRoute: APIRoute = {
  path: '/sessions/:agent/:sessionKey/turns',
  method: 'GET',
  description: 'List turns belonging to one session (indexed)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const sessionKey = url.searchParams.get('sessionKey')
    if (!agent || !sessionKey) {
      return Response.json({ error: 'agent and sessionKey required' }, { status: 400 })
    }
    const { limit, offset } = parseLimitOffset(url)
    const eventType = url.searchParams.get('eventType')
    // Turn rows carry sessionKey inside `meta` (JSON-stringified). That field
    // is indexed as text, so a q-string match on sessionKey narrows to the
    // session without requiring a dedicated facet field.
    const params: SearchQueryParams = {
      q: sessionKey,
      filters: { tier: 'turn', agent, ...(eventType ? { eventType } : {}) },
      limit,
      offset,
      rerank: false,
    }
    const res = await ctx.search.query(params)
    const turns = res.results.map((r) => ({ id: r.id, score: r.score, ...r.fields }))
    return Response.json({ turns, total: res.meta.total })
  },
}

export const turnsListRoute: APIRoute = {
  path: '/turns',
  method: 'GET',
  description: 'List turns by (agent, sessionId)',
  handler: async (req: Request, ctx: PluginContext) => {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent')
    const sessionId = url.searchParams.get('sessionId')
    if (!agent || !sessionId) {
      return Response.json({ error: 'agent and sessionId required' }, { status: 400 })
    }
    const { limit, offset } = parseLimitOffset(url)
    const filters: Record<string, string> = { agent }
    const eventType = url.searchParams.get('eventType')
    if (eventType) filters.eventType = eventType
    return queryTurns(ctx, filters, limit, offset)
  },
}
