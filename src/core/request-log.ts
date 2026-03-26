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

const MAX_RECENT = 200
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
