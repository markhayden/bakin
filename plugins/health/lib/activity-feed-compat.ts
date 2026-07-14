import type {
  UsageEntry,
  UsageFailureGroup,
  UsageFeedData,
  UsageKind,
} from '../types'

type ActivityWindow = UsageFeedData['window']

export interface NormalizedActivityFeed {
  data: UsageFeedData | null
  compatibilityLimited: boolean
}

const USAGE_KINDS = new Set<UsageKind>(['mcp', 'rest', 'agent'])
const ACTIVITY_CLASSES = new Set(['user', 'system', 'routine'])
const COVERAGE_REASONS = new Set(['full_window', 'process_restart', 'buffer_limit'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRate(value: unknown): value is number {
  return isNonnegativeNumber(value) && value <= 1
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUsageEntry(value: unknown): value is UsageEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.ts === 'string'
    && USAGE_KINDS.has(value.kind as UsageKind)
    && ACTIVITY_CLASSES.has(value.activityClass as string)
    && typeof value.name === 'string'
    && (value.agent === null || typeof value.agent === 'string')
    && (value.durationMs === null || isNonnegativeNumber(value.durationMs))
    && (value.status === 'ok' || value.status === 'error')
}

function validEntries(value: unknown): UsageEntry[] {
  return Array.isArray(value) ? value.filter(isUsageEntry) : []
}

function isFailureGroup(value: unknown): boolean {
  if (!isRecord(value)) return false
  return USAGE_KINDS.has(value.kind as UsageKind)
    && typeof value.name === 'string'
    && typeof value.destination === 'string'
    && (value.method === null || typeof value.method === 'string')
    && isNonnegativeInteger(value.attempts)
    && isNonnegativeInteger(value.failures)
    && value.failures <= value.attempts
    && typeof value.firstFailureAt === 'string'
    && typeof value.lastFailureAt === 'string'
    && Array.isArray(value.agents)
    && value.agents.every((agent) => typeof agent === 'string')
    && isNonnegativeInteger(value.unattributedFailures)
    && isNonnegativeInteger(value.systemFailures)
    && (value.medianFailureDurationMs === null || isNonnegativeNumber(value.medianFailureDurationMs))
    && isUsageEntry(value.latestFailure)
}

function isTimeBucket(value: unknown): value is UsageFeedData['timeBuckets'][number] {
  if (!isRecord(value)) return false
  return typeof value.start === 'string'
    && Number.isFinite(Date.parse(value.start))
    && isNonnegativeInteger(value.count)
    && isNonnegativeInteger(value.failureCount)
    && value.failureCount <= value.count
    && isRate(value.failureRate)
}

function isTopByNameRow(value: unknown): value is UsageFeedData['topByName'][number] {
  if (!isRecord(value)) return false
  return (value.kind === undefined || USAGE_KINDS.has(value.kind as UsageKind))
    && (value.method === undefined
      || value.method === null
      || (typeof value.method === 'string' && value.method.length > 0))
    && typeof value.name === 'string'
    && isNonnegativeInteger(value.count)
    && isNonnegativeInteger(value.errors)
    && value.errors <= value.count
    && (value.medianDurationMs === null || isNonnegativeNumber(value.medianDurationMs))
}

function hasValidCapabilities(value: unknown): boolean {
  if (value === undefined) return true
  return isRecord(value)
    && (value.exactFailureTargeting === undefined
      || typeof value.exactFailureTargeting === 'boolean')
    && (value.sourceBalancedActivity === undefined
      || typeof value.sourceBalancedActivity === 'boolean')
}

function isByAgentRow(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.agent === 'string'
    && isNonnegativeInteger(value.count)
    && isNonnegativeInteger(value.errors)
    && value.errors <= value.count
    && (value.lastActivity === null || isUsageEntry(value.lastActivity))
}

function hasConsistentDashboardTotals(data: Partial<UsageFeedData>): boolean {
  if (!isRecord(data.totals) || !isRecord(data.outcomes) || !Array.isArray(data.byKind)) return false
  const total = data.totals.count
  const errors = data.totals.errors
  const { failed, unverified, canceled, succeeded } = data.outcomes
  if (
    !isNonnegativeInteger(total)
    || !isNonnegativeInteger(errors)
    || !isNonnegativeInteger(failed)
    || !isNonnegativeInteger(unverified)
    || !isNonnegativeInteger(canceled)
    || !isNonnegativeInteger(succeeded)
  ) return false

  const kindRows = data.byKind.filter(isRecord)
  const kinds = new Set(kindRows.map((row) => row.kind))
  const kindTotal = kindRows.reduce((sum, row) => sum + Number(row.total), 0)
  const kindFailures = kindRows.reduce((sum, row) => sum + Number(row.failures), 0)
  const expectedErrorRate = total > 0 ? errors / total : 0
  return failed + unverified + canceled + succeeded === total
    && errors === failed
    && Math.abs(data.totals.errorRate - expectedErrorRate) < 1e-9
    && kindRows.length === USAGE_KINDS.size
    && kinds.size === USAGE_KINDS.size
    && kindTotal === total
    && kindFailures === errors
}

function isCanceled(entry: UsageEntry): boolean {
  const terminalStatus = entry.meta?.terminalStatus ?? entry.meta?.turnTerminalStatus
  return entry.status === 'ok' && terminalStatus === 'aborted'
}

function isDashboardContract(data: Partial<UsageFeedData>): data is UsageFeedData {
  const coverage = data.coverage as unknown
  const totals = data.totals as unknown
  const outcomes = data.outcomes as unknown
  return (data.window === '5m' || data.window === '1h' || data.window === '24h')
    && hasValidCapabilities(data.capabilities)
    && isRecord(coverage)
    && typeof coverage.startsAt === 'string'
    && Number.isFinite(Date.parse(coverage.startsAt))
    && typeof coverage.hasFullWindow === 'boolean'
    && COVERAGE_REASONS.has(coverage.reason as string)
    && (coverage.reason === 'full_window') === coverage.hasFullWindow
    && isRecord(totals)
    && isNonnegativeInteger(totals.count)
    && isNonnegativeInteger(totals.errors)
    && totals.errors <= totals.count
    && isRate(totals.errorRate)
    && isRecord(outcomes)
    && isNonnegativeInteger(outcomes.failed)
    && isNonnegativeInteger(outcomes.unverified)
    && isNonnegativeInteger(outcomes.canceled)
    && isNonnegativeInteger(outcomes.succeeded)
    && Array.isArray(data.byKind)
    && data.byKind.every((row) => isRecord(row)
      && USAGE_KINDS.has(row.kind as UsageKind)
      && isNonnegativeInteger(row.total)
      && isNonnegativeInteger(row.failures)
      && row.failures <= row.total)
    && Array.isArray(data.failureGroups)
    && data.failureGroups.every(isFailureGroup)
    && isRecord(data.failureGroupPage)
    && isNonnegativeInteger(data.failureGroupPage.total)
    && isNonnegativeInteger(data.failureGroupPage.offset)
    && isPositiveInteger(data.failureGroupPage.limit)
    && typeof data.failureGroupPage.hasMore === 'boolean'
    && Array.isArray(data.topByName)
    && data.topByName.every(isTopByNameRow)
    && Array.isArray(data.byAgent)
    && data.byAgent.every(isByAgentRow)
    && Array.isArray(data.recent)
    && data.recent.every(isUsageEntry)
    && Array.isArray(data.recentFailures)
    && data.recentFailures.every(isUsageEntry)
    && Array.isArray(data.recentUnverified)
    && data.recentUnverified.every(isUsageEntry)
    && Array.isArray(data.timeBuckets)
    && data.timeBuckets.every(isTimeBucket)
    && hasConsistentDashboardTotals(data)
}

function uniqueEntries(data: Partial<UsageFeedData>): UsageEntry[] {
  const rows = [
    ...validEntries(data.recent),
    ...validEntries(data.recentFailures),
    ...validEntries(data.recentUnverified),
  ]
  const seen = new Set<string>()
  return rows.filter((entry) => {
    const key = entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${entry.agent ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function legacyKindRows(entries: UsageEntry[]) {
  const rows = new Map<UsageKind, { kind: UsageKind; total: number; failures: number }>([
    ['mcp', { kind: 'mcp', total: 0, failures: 0 }],
    ['rest', { kind: 'rest', total: 0, failures: 0 }],
    ['agent', { kind: 'agent', total: 0, failures: 0 }],
  ])
  for (const entry of entries) {
    const row = rows.get(entry.kind)!
    row.total++
    if (entry.status === 'error') row.failures++
  }
  return [...rows.values()]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

function legacyDestination(entry: UsageEntry): string {
  const routePattern = entry.kind === 'rest' ? entry.meta?.routePattern : undefined
  return typeof routePattern === 'string' && routePattern.length > 0 ? routePattern : entry.name
}

function legacyMethod(entry: UsageEntry): string | null {
  if (entry.kind !== 'rest') return null
  const method = entry.meta?.method
  return typeof method === 'string' && method.trim().length > 0 ? method.trim().toUpperCase() : null
}

function legacyFailureSignature(entry: UsageEntry): string {
  return JSON.stringify([entry.kind, legacyMethod(entry), legacyDestination(entry)])
}

function legacyFailureGroups(entries: UsageEntry[], failures: UsageEntry[]): UsageFailureGroup[] {
  const groups = new Map<string, {
    kind: UsageKind
    name: string
    destination: string
    method: string | null
    rows: UsageEntry[]
  }>()
  for (const entry of failures) {
    const destination = legacyDestination(entry)
    const method = legacyMethod(entry)
    const key = legacyFailureSignature(entry)
    const group = groups.get(key) ?? {
      kind: entry.kind,
      name: destination,
      destination,
      method,
      rows: [],
    }
    group.rows.push(entry)
    groups.set(key, group)
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group.rows].sort((left, right) => left.ts.localeCompare(right.ts))
    const attempts = entries.filter((entry) => legacyFailureSignature(entry) === JSON.stringify([
      group.kind,
      group.method,
      group.destination,
    ])).length
    const agents = [...new Set(group.rows.flatMap((entry) => entry.agent ? [entry.agent] : []))].sort()
    return {
      kind: group.kind,
      name: group.name,
      destination: group.destination,
      method: group.method,
      attempts: Math.max(attempts, group.rows.length),
      failures: group.rows.length,
      firstFailureAt: ordered[0]?.ts ?? new Date(0).toISOString(),
      lastFailureAt: ordered.at(-1)?.ts ?? new Date(0).toISOString(),
      agents,
      unattributedFailures: group.rows.filter((entry) => (
        entry.agent === null && entry.activityClass === 'user'
      )).length,
      systemFailures: group.rows.filter((entry) => (
        entry.agent === null && entry.activityClass !== 'user'
      )).length,
      medianFailureDurationMs: median(group.rows.flatMap((entry) => (
        entry.durationMs === null ? [] : [entry.durationMs]
      ))),
      latestFailure: ordered.at(-1)!,
    }
  }).sort((left, right) => (
    right.failures - left.failures
    || right.lastFailureAt.localeCompare(left.lastFailureAt)
  ))
}

function fallbackCoverageStart(data: Partial<UsageFeedData>): string {
  const candidates = [
    ...(Array.isArray(data.timeBuckets) ? data.timeBuckets.filter(isTimeBucket).map((bucket) => bucket.start) : []),
    ...uniqueEntries(data).map((entry) => entry.ts),
  ].filter((value) => Number.isFinite(Date.parse(value)))
  return candidates.sort()[0] ?? new Date().toISOString()
}

/**
 * Keeps Health usable while a dev server or rolling deployment still serves
 * the pre-dashboard feed. The fallback is explicitly marked partial; it never
 * promotes recent capped rows into a claim of complete window coverage.
 */
export function normalizeActivityFeed(
  value: UsageFeedData | null,
  requestedWindow: ActivityWindow,
): NormalizedActivityFeed {
  if (!value) return { data: null, compatibilityLimited: false }
  const legacy = value as Partial<UsageFeedData>
  if (isDashboardContract(legacy)) return { data: legacy, compatibilityLimited: false }

  const recent = validEntries(legacy.recent)
  const recentFailures = validEntries(legacy.recentFailures)
  const recentUnverified = validEntries(legacy.recentUnverified)
  const entries = uniqueEntries(legacy)
  const reportedTotal = isNonnegativeNumber(legacy.totals?.count) ? legacy.totals.count : entries.length
  const reportedFailed = isNonnegativeNumber(legacy.totals?.errors) ? legacy.totals.errors : recentFailures.length
  const failed = Math.max(reportedFailed, recentFailures.length)
  const unverified = recentUnverified.length
  const canceled = entries.filter(isCanceled).length
  const total = Math.max(reportedTotal, entries.length, failed + unverified + canceled)
  const succeeded = Math.max(0, total - failed - unverified - canceled)

  return {
    compatibilityLimited: true,
    data: {
      window: requestedWindow,
      coverage: {
        startsAt: fallbackCoverageStart(legacy),
        hasFullWindow: false,
        reason: 'buffer_limit',
      },
      totals: {
        count: total,
        errors: failed,
        errorRate: total > 0 ? failed / total : 0,
      },
      outcomes: { failed, unverified, canceled, succeeded },
      byKind: legacyKindRows(entries),
      failureGroups: legacyFailureGroups(entries, recentFailures),
      topByName: Array.isArray(legacy.topByName) ? legacy.topByName.filter(isTopByNameRow) : [],
      byAgent: Array.isArray(legacy.byAgent) ? legacy.byAgent : [],
      recent,
      recentFailures,
      recentUnverified,
      timeBuckets: Array.isArray(legacy.timeBuckets) ? legacy.timeBuckets.filter(isTimeBucket) : [],
    },
  }
}
