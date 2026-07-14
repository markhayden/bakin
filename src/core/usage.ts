/**
 * Unified in-memory usage recorder for the health dashboard.
 *
 * One store, one schema, one query API for MCP tool calls, REST requests, and
 * agent lifecycle events. Per-session only — nothing persists across restart.
 * See `.claude/knowledge/usage-recording.md` for the design motivation.
 */

import type { ActivityClass } from '@makinbakin/sdk/types'

export type { ActivityClass } from '@makinbakin/sdk/types'

// Why: shared state on globalThis so repeat evaluations (server entry vs.
// dynamically loaded plugin bundles) don't duplicate the store. Same
// pattern as src/core/sse.ts.
const g = globalThis as unknown as { __bakinUsage?: UsageState }

export type UsageKind = 'mcp' | 'rest' | 'agent'

export interface UsageEntry {
  /** Stable host-process identity assigned by the recorder. */
  id: string
  ts: string
  kind: UsageKind
  /** Assigned by the producer; never inferred from `name`. */
  activityClass: ActivityClass
  name: string
  agent: string | null
  durationMs: number | null
  status: 'ok' | 'error'
  /** Per-turn token usage, when the entry is a completed agent turn. */
  tokensIn?: number
  tokensOut?: number
  /** Provider-cache slices of the input, when the runtime reported them. */
  tokensCacheRead?: number
  tokensCacheWrite?: number
  /** Estimated turn cost in micro-dollars; absent when unmetered. */
  costUsdMicros?: number
  meta?: Record<string, unknown>
}

export interface UsageQuery {
  kind?: UsageKind
  window: WindowKey
  agent?: string
  /** Include verified cadence-only success. Routine failures, result gaps, and cancellations remain visible. */
  includeRoutine?: boolean
  /** Zero-based offset into failure groups after severity/recency ranking. */
  failureGroupOffset?: number
  /** Bounded number of ranked failure groups to return. */
  failureGroupLimit?: number
  /** Resolve the page containing this exact failure signature against the current ranking. */
  failureGroupTarget?: UsageFailureGroupTarget
}

export interface UsageFailureGroupTarget {
  kind: UsageKind
  method: string | null
  destination: string
}

export interface TopByNameRow {
  kind: UsageKind
  method: string | null
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

export interface UsageOutcomeCounts {
  failed: number
  unverified: number
  canceled: number
  succeeded: number
}

export interface UsageKindSummary {
  kind: UsageKind
  total: number
  failures: number
}

export interface UsageFailureGroup {
  kind: UsageKind
  /** Backwards-compatible display alias for `destination`. */
  name: string
  /** Logical destination; REST route template when available, otherwise the raw interaction name. */
  destination: string
  /** Normalized HTTP method for REST destinations; null for non-REST or legacy rows. */
  method: string | null
  attempts: number
  failures: number
  firstFailureAt: string
  lastFailureAt: string
  /** Known agents attached to failed attempts only. */
  agents: string[]
  /** Failed attempts that did not carry an agent identity. */
  unattributedFailures: number
  /** Intentional system/routine failures that do not require an agent identity. */
  systemFailures: number
  /** Median across failed attempts with a recorded duration. */
  medianFailureDurationMs: number | null
  /** Newest failed event in this group, independent of the global recent-event cap. */
  latestFailure: UsageEntry
}

export interface UsageFailureGroupPage {
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export interface UsageFeed {
  capabilities: {
    exactFailureTargeting: true
    /** Bounded mixed-source projections reserve room for each active source. */
    sourceBalancedActivity: true
  }
  window: WindowKey
  coverage: InteractionCoverage
  totals: { count: number; errors: number; errorRate: number }
  /** Exact terminal outcome counts across the full filtered window, not the recent cap. */
  outcomes: UsageOutcomeCounts
  /** Stable mcp/rest/agent rows, including zero-count kinds. */
  byKind: UsageKindSummary[]
  /** Bounded page of failure signatures across the full retained filtered window. */
  failureGroups: UsageFailureGroup[]
  failureGroupPage: UsageFailureGroupPage
  topByName: TopByNameRow[]
  recent: UsageEntry[]
  /** Newest failures are capped independently so successful traffic cannot hide them. */
  recentFailures: UsageEntry[]
  /** Newest result-observation gaps are independently capped for the same reason. */
  recentUnverified: UsageEntry[]
  byAgent: ByAgentRow[]
  timeBuckets: UsageTimeBucket[]
}

export interface UsageTimeBucket {
  start: string
  count: number
  failureCount: number
  failureRate: number
}

export type InteractionCategory = 'tools' | 'api' | 'agents'
export type InteractionCoverageReason = 'full_window' | 'process_restart' | 'buffer_limit'
export type InteractionCoverage =
  | { startsAt: string; hasFullWindow: true; reason: 'full_window' }
  | { startsAt: string; hasFullWindow: false; reason: 'process_restart' }
  | { startsAt: string; hasFullWindow: false; reason: 'buffer_limit' }

export interface InteractionSummary {
  window: WindowKey
  coverage: InteractionCoverage
  totals: {
    count: number
    errors: number
    unverified: number
    foreground: number
    background: number
  }
  categories: Array<{
    key: InteractionCategory
    count: number
    errors: number
  }>
  topDestinations: Array<{
    category: InteractionCategory
    name: string
    count: number
    errors: number
    medianDurationMs: number | null
  }>
  timeBuckets: UsageTimeBucket[]
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

const TIME_BUCKET_COUNTS: Record<WindowKey, number> = {
  '5m': 10,
  '1h': 12,
  '24h': 24,
}

const MAX_ENTRIES = 10_000
const IDLE_THRESHOLD_MS = 30_000
const TOP_N = 10
const RECENT_N = 50
const USAGE_KINDS: UsageKind[] = ['mcp', 'rest', 'agent']
export const DEFAULT_FAILURE_GROUP_LIMIT = 25
export const MAX_FAILURE_GROUP_LIMIT = 100

interface UsageState {
  entries: UsageEntry[]
  /** Monotonic host-local ordering used to reconcile duplicate observers. */
  nextSequence?: number
  entrySequences?: WeakMap<UsageEntry, number>
  claimedObservations?: WeakSet<UsageEntry>
  /** Latest timestamp discarded by the bounded ring, for conservative coverage reporting. */
  evictedThroughMs?: number
  /** Invalid timestamps make all later coverage claims conservatively partial. */
  hasUnknownEviction?: boolean
  /** One-time migration marker for global state preserved across dev hot reload. */
  idsBackfilled?: boolean
}

function getState(): UsageState {
  if (!g.__bakinUsage) {
    g.__bakinUsage = { entries: [] }
  }
  g.__bakinUsage.nextSequence ??= 0
  g.__bakinUsage.entrySequences ??= new WeakMap()
  g.__bakinUsage.claimedObservations ??= new WeakSet()
  if (!g.__bakinUsage.idsBackfilled) {
    // Dev hot reload can preserve rows created before recorder IDs existed.
    for (const entry of g.__bakinUsage.entries) {
      let sequence = g.__bakinUsage.entrySequences.get(entry)
      if (sequence === undefined) {
        sequence = g.__bakinUsage.nextSequence
        g.__bakinUsage.entrySequences.set(entry, sequence)
        g.__bakinUsage.nextSequence = sequence + 1
      } else if (sequence >= g.__bakinUsage.nextSequence) {
        g.__bakinUsage.nextSequence = sequence + 1
      }
      if (typeof entry.id === 'string' && entry.id.length > 0) continue
      entry.id = `usage-${sequence.toString(36)}`
    }
    const usedIds = new Set(g.__bakinUsage.entries.map((entry) => entry.id))
    while (usedIds.has(`usage-${g.__bakinUsage.nextSequence.toString(36)}`)) {
      g.__bakinUsage.nextSequence++
    }
    g.__bakinUsage.idsBackfilled = true
  }
  return g.__bakinUsage
}

export function recordUsage(entry: Omit<UsageEntry, 'id' | 'ts'> & { ts?: string }): void {
  const state = getState()
  const candidate: Omit<UsageEntry, 'id'> = {
    ts: entry.ts ?? new Date().toISOString(),
    kind: entry.kind,
    activityClass: entry.activityClass,
    name: entry.name,
    agent: entry.agent,
    durationMs: entry.durationMs,
    status: entry.status,
    ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
    ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
    ...(entry.tokensCacheRead !== undefined ? { tokensCacheRead: entry.tokensCacheRead } : {}),
    ...(entry.tokensCacheWrite !== undefined ? { tokensCacheWrite: entry.tokensCacheWrite } : {}),
    ...(entry.costUsdMicros !== undefined ? { costUsdMicros: entry.costUsdMicros } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
  }

  const existingAgentTurn = findAgentTurnEntry(state.entries, candidate)
  if (existingAgentTurn) {
    mergeAgentTurnEntry(existingAgentTurn, candidate)
    return
  }

  const sequence = state.nextSequence!
  state.nextSequence = sequence + 1
  const full: UsageEntry = { id: `usage-${sequence.toString(36)}`, ...candidate }
  state.entrySequences!.set(full, sequence)
  state.entries.push(full)
  if (state.entries.length > MAX_ENTRIES) {
    const evicted = state.entries.splice(0, state.entries.length - MAX_ENTRIES)
    for (const removed of evicted) {
      const timestamp = Date.parse(removed.ts)
      if (!Number.isFinite(timestamp)) {
        state.hasUnknownEviction = true
        continue
      }
      state.evictedThroughMs = Math.max(state.evictedThroughMs ?? Number.NEGATIVE_INFINITY, timestamp)
    }
  }
}

function findAgentTurnEntry(entries: UsageEntry[], incoming: Omit<UsageEntry, 'id'>): UsageEntry | undefined {
  if (incoming.kind !== 'agent') return undefined
  const turnId = incoming.meta?.turnId
  if (typeof turnId === 'string' && turnId.length > 0) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const candidate = entries[index]!
      if (candidate.kind === 'agent' && candidate.agent === incoming.agent && candidate.meta?.turnId === turnId) {
        return candidate
      }
    }
    return undefined
  }

  const resultId = incoming.meta?.resultId
  if (typeof resultId !== 'string' || resultId.length === 0) return undefined
  let onlyMatch: UsageEntry | undefined
  for (let index = entries.length - 1; index >= 0; index--) {
    const candidate = entries[index]!
    if (candidate.kind !== 'agent' || candidate.agent !== incoming.agent || candidate.meta?.resultId !== resultId) continue
    if (onlyMatch) return undefined
    onlyMatch = candidate
  }
  return onlyMatch
}

function mergeAgentTurnEntry(existing: UsageEntry, incoming: Omit<UsageEntry, 'id'>): void {
  const existingIsObserver = existing.meta?.source === 'runtime-turn'
  const incomingIsObserver = incoming.meta?.source === 'runtime-turn'

  if (!incomingIsObserver || existingIsObserver === incomingIsObserver) {
    existing.name = incoming.name
  }
  if (incomingIsObserver || !existingIsObserver) {
    existing.activityClass = incoming.activityClass
  }
  if (incoming.durationMs !== null) existing.durationMs = incoming.durationMs
  if (incoming.status === 'error') existing.status = 'error'
  if (incoming.tokensIn !== undefined) existing.tokensIn = incoming.tokensIn
  if (incoming.tokensOut !== undefined) existing.tokensOut = incoming.tokensOut
  if (incoming.tokensCacheRead !== undefined) existing.tokensCacheRead = incoming.tokensCacheRead
  if (incoming.tokensCacheWrite !== undefined) existing.tokensCacheWrite = incoming.tokensCacheWrite
  if (incoming.costUsdMicros !== undefined) existing.costUsdMicros = incoming.costUsdMicros
  existing.meta = { ...(existing.meta ?? {}), ...(incoming.meta ?? {}) }
  if (existingIsObserver || incomingIsObserver) existing.meta.source = 'runtime-turn'
}

/**
 * Return a monotonic cursor before an adapter starts an interaction.
 *
 * The runtime observer sees the same Bakin tool result that the in-process
 * provider or MCP server may already have recorded. The cursor lets the host
 * reconcile only source rows created during that call, without relying on a
 * timestamp heuristic or dropping failures that never reached the source.
 */
export function getUsageObservationCursor(): number {
  return getState().nextSequence!
}

/**
 * Claim one source-recorded interaction created after `afterCursor`.
 * Runtime-reported failure wins over a source success because a lost response
 * is still a failed interaction from the agent's point of view.
 */
export function reconcileObservedUsage(opts: {
  afterCursor: number
  kind: UsageKind
  name: string
  agent: string | null
  observedStatus: UsageEntry['status']
  observerSource: string
  observationMeta?: Record<string, unknown>
}): boolean {
  const state = getState()
  for (let index = state.entries.length - 1; index >= 0; index--) {
    const entry = state.entries[index]!
    const sequence = state.entrySequences!.get(entry)
    if (sequence === undefined || sequence < opts.afterCursor) continue
    if (state.claimedObservations!.has(entry)) continue
    if (entry.kind !== opts.kind || entry.name !== opts.name || entry.agent !== opts.agent) continue
    if (entry.meta?.source === opts.observerSource) continue

    state.claimedObservations!.add(entry)
    if (opts.observedStatus === 'error') entry.status = 'error'
    if (opts.observationMeta) entry.meta = { ...(entry.meta ?? {}), ...opts.observationMeta }
    return true
  }
  return false
}

function filterEntries(query: UsageQuery, now = Date.now()): UsageEntry[] {
  const state = getState()
  const cutoff = now - WINDOW_MS[query.window]
  const out: UsageEntry[] = []
  for (const e of state.entries) {
    const ts = Date.parse(e.ts)
    if (isNaN(ts) || ts < cutoff || ts > now) continue
    if (query.kind && e.kind !== query.kind) continue
    if (query.agent && e.agent !== query.agent) continue
    if (
      !query.includeRoutine
      && e.activityClass === 'routine'
      && e.status === 'ok'
      && !isUnverifiedInteraction(e)
      && !isCanceledInteraction(e)
    ) continue
    out.push(e)
  }
  return out
}

function buildTimeBuckets(
  entries: UsageEntry[],
  window: WindowKey,
  now: number,
): UsageTimeBucket[] {
  const count = TIME_BUCKET_COUNTS[window]
  const bucketMs = WINDOW_MS[window] / count
  const windowStart = now - WINDOW_MS[window]
  const buckets = Array.from({ length: count }, (_, index): UsageTimeBucket => ({
    start: new Date(windowStart + index * bucketMs).toISOString(),
    count: 0,
    failureCount: 0,
    failureRate: 0,
  }))

  for (const entry of entries) {
    const timestamp = Date.parse(entry.ts)
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) continue
    const index = Math.min(count - 1, Math.floor((timestamp - windowStart) / bucketMs))
    const bucket = buckets[index]
    if (!bucket) continue
    bucket.count++
    if (entry.status === 'error') bucket.failureCount++
  }

  for (const bucket of buckets) {
    bucket.failureRate = bucket.count > 0 ? bucket.failureCount / bucket.count : 0
  }
  return buckets
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

/**
 * Take an even cross-source sample from rows that are already ranked within
 * each source. This prevents high-frequency REST polling from consuming every
 * bounded Activity slot while keeping exact totals untouched.
 */
function takeSourceBalanced<T extends { kind: UsageKind }>(rows: T[], limit: number): T[] {
  const rowsByKind = new Map<UsageKind, T[]>(
    USAGE_KINDS.map((kind) => [kind, rows.filter((row) => row.kind === kind)]),
  )
  const selected: T[] = []

  for (let rank = 0; selected.length < limit; rank++) {
    let foundAtRank = false
    for (const kind of USAGE_KINDS) {
      const row = rowsByKind.get(kind)?.[rank]
      if (!row) continue
      foundAtRank = true
      selected.push(row)
      if (selected.length === limit) break
    }
    if (!foundAtRank) break
  }

  return selected
}

function newestUsageFirst(left: UsageEntry, right: UsageEntry): number {
  return left.ts < right.ts ? 1 : left.ts > right.ts ? -1 : 0
}

function selectRecentActivity(entries: UsageEntry[], kind: UsageKind | undefined): UsageEntry[] {
  const newest = [...entries].sort(newestUsageFirst)
  if (kind) return newest.slice(0, RECENT_N)

  const meaningful = takeSourceBalanced(newest.filter(isMeaningfulInteraction), RECENT_N)
  const routine = takeSourceBalanced(
    newest.filter((entry) => !isMeaningfulInteraction(entry)),
    RECENT_N - meaningful.length,
  )

  return [...meaningful, ...routine].sort(newestUsageFirst)
}

export function getUsageFeed(query: UsageQuery): UsageFeed {
  const now = Date.now()
  const projectedEntries = filterEntries({ ...query, includeRoutine: true }, now)
    .map(projectInteractionOutcome)
  const observableEntries = projectedEntries.filter(isObservableInteraction)
  const entries = observableEntries
    .filter((entry) => query.includeRoutine
      || entry.activityClass !== 'routine'
      || entry.status === 'error'
      || isUnverifiedInteraction(entry)
      || isCanceledInteraction(entry))
  const totalCount = entries.length
  const errorCount = entries.reduce((n, e) => (e.status === 'error' ? n + 1 : n), 0)

  const outcomes: UsageOutcomeCounts = { failed: 0, unverified: 0, canceled: 0, succeeded: 0 }
  const kindCounts = new Map<UsageKind, { total: number; failures: number }>(
    USAGE_KINDS.map((kind) => [kind, { total: 0, failures: 0 }]),
  )
  const attemptsByDestination = new Map<string, number>()
  const failuresByDestination = new Map<string, {
    kind: UsageKind
    name: string
    destination: string
    method: string | null
    failures: number
    firstFailureAt: string
    firstFailureMs: number
    lastFailureAt: string
    lastFailureMs: number
    agents: Set<string>
    unattributedFailures: number
    systemFailures: number
    durations: number[]
    latestFailure: UsageEntry
  }>()

  // Failure recurrence must use every attempt at the failed operation. Routine
  // success stays out of the visible feed, but it remains valid denominator
  // evidence for a failure pattern (for example, 1 failed poll out of 60).
  for (const entry of projectedEntries) {
    const { key } = failureGroupSignature(entry)
    attemptsByDestination.set(key, (attemptsByDestination.get(key) ?? 0) + 1)
  }

  for (const entry of entries) {
    const kind = kindCounts.get(entry.kind)!
    kind.total++

    if (entry.status === 'error') {
      outcomes.failed++
      kind.failures++
    } else if (isUnverifiedInteraction(entry)) {
      outcomes.unverified++
    } else if (isCanceledInteraction(entry)) {
      outcomes.canceled++
    } else {
      outcomes.succeeded++
    }

    const signature = failureGroupSignature(entry)
    const { destination, method, key } = signature
    if (entry.status !== 'error') continue

    const failureMs = Date.parse(entry.ts)
    const failure = failuresByDestination.get(key) ?? {
      kind: entry.kind,
      name: destination,
      destination,
      method,
      failures: 0,
      firstFailureAt: entry.ts,
      firstFailureMs: failureMs,
      lastFailureAt: entry.ts,
      lastFailureMs: failureMs,
      agents: new Set<string>(),
      unattributedFailures: 0,
      systemFailures: 0,
      durations: [],
      latestFailure: entry,
    }
    failure.failures++
    if (failureMs < failure.firstFailureMs) {
      failure.firstFailureAt = entry.ts
      failure.firstFailureMs = failureMs
    }
    if (failureMs >= failure.lastFailureMs) {
      failure.lastFailureAt = entry.ts
      failure.lastFailureMs = failureMs
      failure.latestFailure = entry
    }
    if (entry.agent) failure.agents.add(entry.agent)
    else if (entry.activityClass === 'system' || entry.activityClass === 'routine') failure.systemFailures++
    else failure.unattributedFailures++
    if (entry.durationMs !== null) failure.durations.push(entry.durationMs)
    failuresByDestination.set(key, failure)
  }

  const byKind: UsageKindSummary[] = USAGE_KINDS.map((kind) => ({
    kind,
    ...kindCounts.get(kind)!,
  }))
  const rankedFailureGroups: UsageFailureGroup[] = [...failuresByDestination.entries()]
    .map(([key, failure]) => ({
      kind: failure.kind,
      name: failure.name,
      destination: failure.destination,
      method: failure.method,
      attempts: attemptsByDestination.get(key) ?? failure.failures,
      failures: failure.failures,
      firstFailureAt: failure.firstFailureAt,
      lastFailureAt: failure.lastFailureAt,
      agents: [...failure.agents].sort((left, right) => left.localeCompare(right)),
      unattributedFailures: failure.unattributedFailures,
      systemFailures: failure.systemFailures,
      medianFailureDurationMs: median(failure.durations),
      latestFailure: failure.latestFailure,
    }))
    .sort((left, right) =>
      right.failures - left.failures
      || Date.parse(right.lastFailureAt) - Date.parse(left.lastFailureAt)
      || left.kind.localeCompare(right.kind)
      || left.name.localeCompare(right.name),
    )
  const failureGroupLimit = normalizeFailureGroupLimit(query.failureGroupLimit)
  const requestedFailureGroupOffset = normalizeFailureGroupOffset(query.failureGroupOffset)
  const targetRank = query.failureGroupTarget
    ? rankedFailureGroups.findIndex((group) =>
        group.kind === query.failureGroupTarget?.kind
        && group.method === query.failureGroupTarget.method
        && group.destination === query.failureGroupTarget.destination,
      )
    : -1
  const failureGroupOffset = targetRank >= 0
    ? Math.floor(targetRank / failureGroupLimit) * failureGroupLimit
    : requestedFailureGroupOffset
  const failureGroups = rankedFailureGroups.slice(
    failureGroupOffset,
    failureGroupOffset + failureGroupLimit,
  )
  const failureGroupPage: UsageFailureGroupPage = {
    total: rankedFailureGroups.length,
    offset: failureGroupOffset,
    limit: failureGroupLimit,
    hasMore: failureGroupOffset + failureGroups.length < rankedFailureGroups.length,
  }
  const byName = new Map<string, {
    kind: UsageKind
    method: string | null
    name: string
    count: number
    errors: number
    meaningfulCount: number
    durations: number[]
  }>()
  for (const e of entries) {
    const { destination, method, key } = failureGroupSignature(e)
    const bucket = byName.get(key) ?? {
      kind: e.kind,
      method,
      name: destination,
      count: 0,
      errors: 0,
      meaningfulCount: 0,
      durations: [],
    }
    bucket.count++
    if (e.status === 'error') bucket.errors++
    if (isMeaningfulInteraction(e)) bucket.meaningfulCount++
    if (e.durationMs !== null) bucket.durations.push(e.durationMs)
    byName.set(key, bucket)
  }
  const byNameBuckets = [...byName.values()]
  const rankedByName = [...byNameBuckets]
    .sort((left, right) =>
      Number(right.meaningfulCount > 0) - Number(left.meaningfulCount > 0)
      || right.meaningfulCount - left.meaningfulCount
      || right.count - left.count
      || left.name.localeCompare(right.name),
    )
  const selectedByName = query.kind
    ? byNameBuckets
        .sort((left, right) =>
          right.count - left.count
          || right.errors - left.errors
          || left.name.localeCompare(right.name),
        )
        .slice(0, TOP_N)
    : takeSourceBalanced(rankedByName, TOP_N)
  const topByName: TopByNameRow[] = selectedByName
    .map((bucket) => ({
      kind: bucket.kind,
      method: bucket.method,
      name: bucket.name,
      count: bucket.count,
      errors: bucket.errors,
      medianDurationMs: median(bucket.durations),
    }))
    .sort((left, right) =>
      right.count - left.count
      || right.errors - left.errors
      || left.name.localeCompare(right.name),
    )

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

  const recent = selectRecentActivity(entries, query.kind)
  const recentFailures = entries
    .filter((entry) => entry.status === 'error')
    .sort(newestUsageFirst)
    .slice(0, RECENT_N)
  const recentUnverified = entries
    .filter(isUnverifiedInteraction)
    .sort(newestUsageFirst)
    .slice(0, RECENT_N)

  return {
    capabilities: { exactFailureTargeting: true, sourceBalancedActivity: true },
    window: query.window,
    coverage: interactionCoverage(query.window, now),
    totals: {
      count: totalCount,
      errors: errorCount,
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
    },
    outcomes,
    byKind,
    failureGroups,
    failureGroupPage,
    topByName,
    recent,
    recentFailures,
    recentUnverified,
    byAgent,
    timeBuckets: buildTimeBuckets(entries, query.window, now),
  }
}

const INTERACTION_CATEGORIES: InteractionCategory[] = ['tools', 'api', 'agents']

function categoryForKind(kind: UsageKind): InteractionCategory {
  if (kind === 'mcp') return 'tools'
  if (kind === 'rest') return 'api'
  return 'agents'
}

/** Prefer additive REST producer route metadata without rewriting raw event names. */
function interactionDestination(entry: UsageEntry): string {
  const routePattern = entry.kind === 'rest' ? entry.meta?.routePattern : undefined
  return typeof routePattern === 'string' && routePattern.length > 0
    ? routePattern
    : entry.name
}

function interactionMethod(entry: UsageEntry): string | null {
  if (entry.kind !== 'rest') return null
  const method = entry.meta?.method
  return typeof method === 'string' && method.trim().length > 0
    ? method.trim().toUpperCase()
    : null
}

function failureGroupSignature(entry: UsageEntry): {
  destination: string
  method: string | null
  key: string
} {
  const destination = interactionDestination(entry)
  const method = interactionMethod(entry)
  return {
    destination,
    method,
    key: JSON.stringify([entry.kind, method, destination]),
  }
}

function normalizeFailureGroupOffset(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function normalizeFailureGroupLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FAILURE_GROUP_LIMIT
  return Math.min(MAX_FAILURE_GROUP_LIMIT, Math.max(1, Math.floor(value)))
}

function interactionFailed(entry: UsageEntry): boolean {
  if (entry.status === 'error') return true
  const httpStatus = entry.kind === 'rest' ? entry.meta?.httpStatus : undefined
  return typeof httpStatus === 'number' && httpStatus >= 400
}

function projectInteractionOutcome(entry: UsageEntry): UsageEntry {
  return interactionFailed(entry) && entry.status !== 'error'
    ? { ...entry, status: 'error' }
    : entry
}

/**
 * The REST recorder intentionally retains MCP HTTP envelopes for transport
 * watchdogs. User-facing projections suppress successful envelopes already
 * represented by a logical tool row, but keep 4xx/5xx transport failures that
 * may have prevented any logical MCP interaction from being recorded.
 */
function isObservableInteraction(entry: UsageEntry): boolean {
  const mcpTransport = entry.kind === 'rest'
    && (entry.name === '/mcp' || entry.name.startsWith('/mcp/'))
  return !mcpTransport || interactionFailed(entry)
}

function isMeaningfulInteraction(entry: UsageEntry): boolean {
  return entry.activityClass !== 'routine'
    || entry.status === 'error'
    || isUnverifiedInteraction(entry)
    || isCanceledInteraction(entry)
}

function isUnverifiedInteraction(entry: UsageEntry): boolean {
  return entry.kind === 'mcp'
    && entry.status === 'ok'
    && entry.meta?.resultMissing === true
    && entry.meta?.turnTerminalStatus === 'completed'
}

function isCanceledInteraction(entry: UsageEntry): boolean {
  const terminalStatus = entry.meta?.terminalStatus ?? entry.meta?.turnTerminalStatus
  return entry.status === 'ok' && terminalStatus === 'aborted'
}

function interactionCoverage(window: WindowKey, now: number): InteractionCoverage {
  const windowMs = WINDOW_MS[window]
  const requestedStart = now - windowMs
  const rawUptimeMs = process.uptime() * 1_000
  const uptimeMs = Number.isFinite(rawUptimeMs) && rawUptimeMs >= 0 ? rawUptimeMs : 0
  const processStart = now - uptimeMs
  const state = getState()
  const bufferLimited = state.hasUnknownEviction === true
    || (state.evictedThroughMs !== undefined && state.evictedThroughMs >= requestedStart)

  if (bufferLimited) {
    const retainedStart = state.hasUnknownEviction
      ? now
      : Math.min(now, state.evictedThroughMs ?? now)
    return {
      startsAt: new Date(Math.max(requestedStart, processStart, retainedStart)).toISOString(),
      hasFullWindow: false,
      reason: 'buffer_limit',
    }
  }

  const hasFullWindow = uptimeMs >= windowMs
  const startsAt = new Date(Math.max(requestedStart, processStart)).toISOString()
  return hasFullWindow
    ? { startsAt, hasFullWindow: true, reason: 'full_window' }
    : { startsAt, hasFullWindow: false, reason: 'process_restart' }
}

/**
 * Compact meaningful-interaction projection for the Overview dashboard.
 *
 * User and autonomous system work count. Successful polling, heartbeats, and
 * static delivery do not; their failures remain visible.
 */
export function getInteractionSummary(query: Pick<UsageQuery, 'window'>): InteractionSummary {
  const now = Date.now()
  const entries = filterEntries({ window: query.window, includeRoutine: true }, now)
    .filter(isObservableInteraction)
    .map(projectInteractionOutcome)
    .filter(isMeaningfulInteraction)
  const totals = {
    count: entries.length,
    errors: 0,
    unverified: 0,
    foreground: 0,
    background: 0,
  }
  const categoryCounts = new Map<InteractionCategory, { count: number; errors: number }>(
    INTERACTION_CATEGORIES.map((key) => [key, { count: 0, errors: 0 }]),
  )

  for (const entry of entries) {
    const category = categoryForKind(entry.kind)
    const counts = categoryCounts.get(category)!
    counts.count++
    if (entry.status === 'error') {
      totals.errors++
      counts.errors++
    }
    if (isUnverifiedInteraction(entry)) totals.unverified++
    if (entry.activityClass === 'user') totals.foreground++
    else totals.background++
  }

  const destinations = new Map<
    string,
    {
      category: InteractionCategory
      name: string
      count: number
      errors: number
      durations: number[]
    }
  >()
  for (const entry of entries) {
    const category = categoryForKind(entry.kind)
    const name = interactionDestination(entry)
    const key = `${category}\0${name}`
    const destination = destinations.get(key) ?? {
      category,
      name,
      count: 0,
      errors: 0,
      durations: [],
    }
    destination.count++
    if (entry.status === 'error') destination.errors++
    if (entry.durationMs !== null) destination.durations.push(entry.durationMs)
    destinations.set(key, destination)
  }

  const rankedDestinations = [...destinations.values()]
    .map(({ durations, ...destination }) => ({
      ...destination,
      medianDurationMs: median(durations),
    }))
    .sort((a, b) =>
      b.count - a.count
      || b.errors - a.errors
      || a.category.localeCompare(b.category)
      || a.name.localeCompare(b.name),
    )
  let selectedDestinations = rankedDestinations.slice(0, TOP_N)
  if (totals.errors > 0 && !selectedDestinations.some((destination) => destination.errors > 0)) {
    const failedDestination = [...rankedDestinations]
      .filter((destination) => destination.errors > 0)
      .sort((a, b) =>
        b.errors - a.errors
        || b.count - a.count
        || a.category.localeCompare(b.category)
        || a.name.localeCompare(b.name),
      )[0]
    if (failedDestination) {
      selectedDestinations = [...selectedDestinations.slice(0, TOP_N - 1), failedDestination]
    }
  }

  return {
    window: query.window,
    coverage: interactionCoverage(query.window, now),
    totals,
    categories: INTERACTION_CATEGORIES.map((key) => ({ key, ...categoryCounts.get(key)! })),
    topDestinations: selectedDestinations,
    timeBuckets: buildTimeBuckets(entries, query.window, now),
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
export function getStatsByMs(query: {
  kind?: UsageKind
  windowMs: number
  agent?: string
  includeRoutine?: boolean
}): { total: number; errors: number } {
  const state = getState()
  const now = Date.now()
  const cutoff = now - query.windowMs
  let total = 0
  let errors = 0
  for (const e of state.entries) {
    const ts = Date.parse(e.ts)
    if (isNaN(ts) || ts < cutoff || ts > now) continue
    if (query.kind && e.kind !== query.kind) continue
    if (query.agent && e.agent !== query.agent) continue
    if (
      !query.includeRoutine
      && e.activityClass === 'routine'
      && e.status === 'ok'
      && !isUnverifiedInteraction(e)
      && !isCanceledInteraction(e)
    ) continue
    total++
    if (e.status === 'error') errors++
  }
  return { total, errors }
}

export function getErrorCount(windowMs: number): ErrorCount {
  const state = getState()
  const now = Date.now()
  const cutoff = now - windowMs
  const byKind = { mcp: 0, rest: 0, agent: 0 }
  let total = 0
  for (const rawEntry of state.entries) {
    const ts = Date.parse(rawEntry.ts)
    if (isNaN(ts) || ts < cutoff || ts > now) continue
    if (!isObservableInteraction(rawEntry)) continue
    const entry = projectInteractionOutcome(rawEntry)
    if (entry.status !== 'error') continue
    total++
    byKind[entry.kind]++
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
  const state = getState()
  state.entries = []
  delete state.evictedThroughMs
  delete state.hasUnknownEviction
}

export function getEntryCount(): number {
  return getState().entries.length
}
