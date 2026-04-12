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
