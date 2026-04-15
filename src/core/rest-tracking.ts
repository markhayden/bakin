/**
 * REST request tracking middleware helper.
 *
 * Wraps `res.end` to emit a `recordUsage({ kind: 'rest', ... })` entry when
 * the response completes. Extracted from server.ts so it can be unit/
 * integration tested without spinning up an HTTP server.
 */

import type { IncomingMessage, ServerResponse } from 'http'

import { recordUsage } from './usage'

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
