/**
 * In-memory API request log for observability.
 * Tracks recent requests and per-endpoint counts.
 * Resets on server restart — not persisted.
 */

export interface RequestEntry {
  ts: string
  method: string
  path: string
  status: number
  durationMs: number
  agent?: string
}

interface EndpointStats {
  count: number
  errors: number
  lastCalled: string
}

const MAX_RECENT = 1000
const recent: RequestEntry[] = []
const endpoints = new Map<string, EndpointStats>()
let totalRequests = 0
let totalErrors = 0
const startedAt = new Date().toISOString()

/**
 * Record a completed request.
 */
export function recordRequest(entry: RequestEntry): void {
  totalRequests++
  if (entry.status >= 400) totalErrors++

  // Recent log (ring buffer)
  if (recent.length >= MAX_RECENT) recent.shift()
  recent.push(entry)

  // Per-endpoint stats
  const key = `${entry.method} ${entry.path}`
  const existing = endpoints.get(key)
  if (existing) {
    existing.count++
    if (entry.status >= 400) existing.errors++
    existing.lastCalled = entry.ts
  } else {
    endpoints.set(key, {
      count: 1,
      errors: entry.status >= 400 ? 1 : 0,
      lastCalled: entry.ts,
    })
  }
}

/**
 * Window-scoped stats for any path prefix. Used by the watchdog (MCP 5xx
 * alerting) and the Health page (success-rate tile). Walks the in-memory
 * ring buffer — no new storage. Returns counts only; the caller decides
 * what threshold counts as "unhealthy".
 */
export function getRecentStatsForPathPrefix(
  prefix: string,
  windowMs: number,
): { total: number; errors: number } {
  const cutoff = Date.now() - windowMs
  let total = 0
  let errors = 0
  for (const entry of recent) {
    if (!entry.path.startsWith(prefix)) continue
    const ts = Date.parse(entry.ts)
    if (isNaN(ts) || ts < cutoff) continue
    total++
    if (entry.status >= 500) errors++
  }
  return { total, errors }
}

/**
 * Bucketed REST stats by plugin id, derived from the ring buffer. Used by
 * the Health page to surface per-plugin REST traffic alongside the MCP
 * tile, so we can see which plugins agents are hitting via REST instead
 * of MCP tools.
 *
 * Only counts paths under `/api/plugins/{pluginId}/...`. Anything else
 * (top-level /api routes, /mcp, static assets) is ignored.
 */
export interface RestPluginStats {
  pluginId: string
  total: number
  errors: number
  successRate: number
  perMethod: Record<string, number>
  lastCalled: string | null
}

export function getRestStatsByPlugin(windowMs: number): {
  windowSec: number
  total: number
  errors: number
  successRate: number
  byPlugin: RestPluginStats[]
} {
  const cutoff = Date.now() - windowMs
  const buckets = new Map<string, RestPluginStats>()
  let total = 0
  let errors = 0

  for (const entry of recent) {
    const ts = Date.parse(entry.ts)
    if (isNaN(ts) || ts < cutoff) continue
    if (!entry.path.startsWith('/api/plugins/')) continue

    // Extract plugin id: /api/plugins/{pluginId}/...
    const rest = entry.path.slice('/api/plugins/'.length)
    const slash = rest.indexOf('/')
    const pluginId = slash === -1 ? rest : rest.slice(0, slash)
    if (!pluginId) continue

    total++
    const isError = entry.status >= 500
    if (isError) errors++

    let bucket = buckets.get(pluginId)
    if (!bucket) {
      bucket = {
        pluginId,
        total: 0,
        errors: 0,
        successRate: 1,
        perMethod: {},
        lastCalled: null,
      }
      buckets.set(pluginId, bucket)
    }
    bucket.total++
    if (isError) bucket.errors++
    bucket.perMethod[entry.method] = (bucket.perMethod[entry.method] ?? 0) + 1
    if (!bucket.lastCalled || entry.ts > bucket.lastCalled) {
      bucket.lastCalled = entry.ts
    }
  }

  for (const bucket of buckets.values()) {
    bucket.successRate = bucket.total > 0
      ? (bucket.total - bucket.errors) / bucket.total
      : 1
  }

  return {
    windowSec: Math.round(windowMs / 1000),
    total,
    errors,
    successRate: total > 0 ? (total - errors) / total : 1,
    byPlugin: Array.from(buckets.values()).sort((a, b) => b.total - a.total),
  }
}

/**
 * Get current stats snapshot.
 */
export function getRequestStats() {
  // Sort endpoints by call count descending
  const endpointList = Array.from(endpoints.entries())
    .map(([endpoint, stats]) => ({ endpoint, ...stats }))
    .sort((a, b) => b.count - a.count)

  return {
    totalRequests,
    totalErrors,
    upSince: startedAt,
    endpoints: endpointList,
    recent: recent.slice(-50).reverse(),
  }
}
