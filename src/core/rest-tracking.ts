/**
 * REST request tracking middleware helper.
 *
 * Wraps `res.end` to emit two usage records when the response completes:
 *   1. Legacy `recordRequest` (request-log.ts) — kept for backward compat,
 *      removed in Phase 5 of the health plugin overhaul.
 *   2. Unified `recordUsage` (usage.ts) — the new in-memory usage recorder
 *      that feeds the health dashboard.
 *
 * Extracted from server.ts so it can be unit/integration tested without
 * spinning up an HTTP server. See `.claude/specs/health-plugin-overhaul.md`.
 */

import type { IncomingMessage, ServerResponse } from 'http'

import { recordRequest } from './request-log'
import { recordUsage } from './usage'

/**
 * Wrap `res.end` so that when the response completes we emit usage entries
 * to both the legacy request log and the new unified usage recorder.
 */
export function trackResponse(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  startMs: number,
): void {
  const origEnd = res.end.bind(res)
  res.end = function (...args: Parameters<typeof res.end>) {
    const path = url.pathname.replace(/\?.*/, '')
    const durationMs = Date.now() - startMs
    const agent = resolveAgent(req, url)
    const method = req.method || 'GET'
    const status = res.statusCode

    recordRequest({
      ts: new Date().toISOString(),
      method,
      path,
      status,
      durationMs,
      agent: agent ?? undefined,
    })

    recordUsage({
      kind: 'rest',
      name: normalizePath(path),
      agent,
      durationMs,
      status: status >= 400 ? 'error' : 'ok',
      meta: { method, httpStatus: status },
    })

    return origEnd(...args)
  } as typeof res.end
}

/**
 * Resolve the agent attribution for a request.
 *
 * Precedence: `x-bakin-agent` header beats `?agent=` query param. Returns
 * null when neither is set so downstream code can distinguish "anonymous"
 * from a caller that explicitly identified itself.
 */
function resolveAgent(req: IncomingMessage, url: URL): string | null {
  const header = req.headers['x-bakin-agent']
  if (typeof header === 'string' && header.length > 0) return header
  const q = url.searchParams.get('agent')
  return q && q.length > 0 ? q : null
}

/**
 * Normalize a request path for usage grouping.
 *
 * Plugin routes under `/api/plugins/{pluginId}/...` are kept verbatim —
 * plugin ids are fixed strings and grouping by the full path is the desired
 * behavior. Everywhere else we replace UUID-shaped segments with `:id` so a
 * single resource listing doesn't explode the top-paths chart with one row
 * per record id.
 */
export function normalizePath(path: string): string {
  if (path.startsWith('/api/plugins/')) return path
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return path
    .split('/')
    .map(seg => (UUID_RE.test(seg) ? ':id' : seg))
    .join('/')
}
