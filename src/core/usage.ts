/**
 * Unified in-memory usage recorder for the health dashboard.
 *
 * One store, one schema, one query API for MCP tool calls, REST requests, and
 * agent lifecycle events. Per-session only — nothing persists across restart.
 * See `.claude/knowledge/usage-recording.md` for the design motivation.
 */

// Why: shared state on globalThis so repeat evaluations (server entry vs.
// dynamically loaded plugin bundles) don't duplicate the store. Same
// pattern as src/core/sse.ts.
const g = globalThis as unknown as { __bakinUsage?: UsageState }

export type UsageKind = 'mcp' | 'rest' | 'agent'

export interface UsageEntry {
  ts: string
  kind: UsageKind
  name: string
  agent: string | null
  durationMs: number | null
  status: 'ok' | 'error'
  /** Per-turn token usage, when the entry is a completed agent turn. */
  tokensIn?: number
  tokensOut?: number
  /** Estimated turn cost in micro-dollars; absent when unmetered. */
  costUsdMicros?: number
  meta?: Record<string, unknown>
}

export interface UsageQuery {
  kind?: UsageKind
  window: WindowKey
  agent?: string
}

export interface TopByNameRow {
  name: string
  count: number
  errors: number
  medianDurationMs: number | null
}

export interface ByAgentRow {
  agent: string
  count: number
  errors: number
  lastActivity: UsageEntry | null
}

export interface UsageFeed {
  totals: { count: number; errors: number; errorRate: number }
  topByName: TopByNameRow[]
  recent: UsageEntry[]
  byAgent: ByAgentRow[]
}

export interface ErrorCount {
  total: number
  byKind: { mcp: number; rest: number; agent: number }
}

export interface CurrentAgentActivity {
  agent: string
  latest: UsageEntry
  idleSec: number
}

export type WindowKey = '5m' | '1h' | '24h'

export const WINDOW_MS: Record<WindowKey, number> = {
  '5m': 300_000,
  '1h': 3_600_000,
  '24h': 86_400_000,
}

const MAX_ENTRIES = 10_000
const IDLE_THRESHOLD_MS = 30_000
const TOP_N = 10
const RECENT_N = 50

interface UsageState {
  entries: UsageEntry[]
}

function getState(): UsageState {
  if (!g.__bakinUsage) {
    g.__bakinUsage = { entries: [] }
  }
  return g.__bakinUsage
}

export function recordUsage(entry: Omit<UsageEntry, 'ts'> & { ts?: string }): void {
  const state = getState()
  const full: UsageEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    kind: entry.kind,
    name: entry.name,
    agent: entry.agent,
    durationMs: entry.durationMs,
    status: entry.status,
    ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
    ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
    ...(entry.costUsdMicros !== undefined ? { costUsdMicros: entry.costUsdMicros } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
  }
  state.entries.push(full)
  if (state.entries.length > MAX_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_ENTRIES)
  }
}

function filterEntries(query: UsageQuery): UsageEntry[] {
  const state = getState()
  const cutoff = Date.now() - WINDOW_MS[query.window]
  const out: UsageEntry[] = []
  for (const e of state.entries) {
    const ts = Date.parse(e.ts)
    if (isNaN(ts) || ts < cutoff) continue
    if (query.kind && e.kind !== query.kind) continue
    if (query.agent && e.agent !== query.agent) continue
    out.push(e)
  }
  return out
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

export function getUsageFeed(query: UsageQuery): UsageFeed {
  const entries = filterEntries(query)
  const totalCount = entries.length
  const errorCount = entries.reduce((n, e) => (e.status === 'error' ? n + 1 : n), 0)

  const byName = new Map<string, { count: number; errors: number; durations: number[] }>()
  for (const e of entries) {
    const bucket = byName.get(e.name) ?? { count: 0, errors: 0, durations: [] }
    bucket.count++
    if (e.status === 'error') bucket.errors++
    if (e.durationMs !== null) bucket.durations.push(e.durationMs)
    byName.set(e.name, bucket)
  }
  const topByName: TopByNameRow[] = [...byName.entries()]
    .map(([name, b]) => ({
      name,
      count: b.count,
      errors: b.errors,
      medianDurationMs: median(b.durations),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)

  const byAgentMap = new Map<string, { count: number; errors: number; lastActivity: UsageEntry | null }>()
  for (const e of entries) {
    const key = e.agent ?? 'unknown'
    const bucket = byAgentMap.get(key) ?? { count: 0, errors: 0, lastActivity: null }
    bucket.count++
    if (e.status === 'error') bucket.errors++
    if (!bucket.lastActivity || e.ts > bucket.lastActivity.ts) bucket.lastActivity = e
    byAgentMap.set(key, bucket)
  }
  const byAgent: ByAgentRow[] = [...byAgentMap.entries()]
    .map(([agent, b]) => ({ agent, count: b.count, errors: b.errors, lastActivity: b.lastActivity }))
    .sort((a, b) => b.count - a.count)

  const recent = [...entries]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, RECENT_N)

  return {
    totals: {
      count: totalCount,
      errors: errorCount,
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
    },
    topByName,
    recent,
    byAgent,
  }
}

export function getUsageStats(query: UsageQuery): { total: number; errors: number } {
  const entries = filterEntries(query)
  let errors = 0
  for (const e of entries) if (e.status === 'error') errors++
  return { total: entries.length, errors }
}

// Watchdog-facing variant: takes raw windowMs from settings rather than a
// named WindowKey, so alert thresholds stay configurable without having to
// pin to 5m/1h/24h buckets.
export function getStatsByMs(query: { kind?: UsageKind; windowMs: number; agent?: string }): { total: number; errors: number } {
  const state = getState()
  const cutoff = Date.now() - query.windowMs
  let total = 0
  let errors = 0
  for (const e of state.entries) {
    const ts = Date.parse(e.ts)
    if (isNaN(ts) || ts < cutoff) continue
    if (query.kind && e.kind !== query.kind) continue
    if (query.agent && e.agent !== query.agent) continue
    total++
    if (e.status === 'error') errors++
  }
  return { total, errors }
}

export function getErrorCount(windowMs: number): ErrorCount {
  const state = getState()
  const cutoff = Date.now() - windowMs
  const byKind = { mcp: 0, rest: 0, agent: 0 }
  let total = 0
  for (const e of state.entries) {
    if (e.status !== 'error') continue
    const ts = Date.parse(e.ts)
    if (isNaN(ts) || ts < cutoff) continue
    total++
    byKind[e.kind]++
  }
  return { total, byKind }
}

export function getCurrentAgentActivity(): CurrentAgentActivity[] {
  const state = getState()
  const latestByAgent = new Map<string, UsageEntry>()
  for (const e of state.entries) {
    if (!e.agent) continue
    const prev = latestByAgent.get(e.agent)
    if (!prev || e.ts > prev.ts) latestByAgent.set(e.agent, e)
  }
  const now = Date.now()
  return [...latestByAgent.entries()]
    .map(([agent, latest]) => {
      const ts = Date.parse(latest.ts)
      const idleSec = Math.max(0, Math.floor((now - ts) / 1000))
      return { agent, latest, idleSec }
    })
    .sort((a, b) => a.idleSec - b.idleSec)
}

export function isAgentIdle(idleSec: number): boolean {
  return idleSec * 1000 >= IDLE_THRESHOLD_MS
}

export function clearUsage(): void {
  getState().entries = []
}

export function getEntryCount(): number {
  return getState().entries.length
}
