import type {
  UsageEntry,
  UsageFailureGroup,
  UsageFeedData,
  UsageKind,
} from '../types'
import { usageFeedResponseSchema } from './usage-feed-route-schema'

type ActivityWindow = UsageFeedData['window']

export interface NormalizedActivityFeed {
  data: UsageFeedData | null
  compatibilityLimited: boolean
}

const USAGE_KINDS = new Set<UsageKind>(['mcp', 'rest', 'agent'])
const ACTIVITY_CLASSES = new Set(['user', 'system', 'routine'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRate(value: unknown): value is number {
  return isNonnegativeNumber(value) && value <= 1
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUsageEntry(value: unknown): value is UsageEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.ts === 'string'
    && Number.isFinite(Date.parse(value.ts))
    && USAGE_KINDS.has(value.kind as UsageKind)
    && ACTIVITY_CLASSES.has(value.activityClass as string)
    && typeof value.name === 'string'
    && (value.agent === null || typeof value.agent === 'string')
    && (value.durationMs === null || isNonnegativeNumber(value.durationMs))
    && (value.status === 'ok' || value.status === 'error')
    && (value.tokensIn === undefined || isNonnegativeNumber(value.tokensIn))
    && (value.tokensOut === undefined || isNonnegativeNumber(value.tokensOut))
    && (value.tokensCacheRead === undefined || isNonnegativeNumber(value.tokensCacheRead))
    && (value.tokensCacheWrite === undefined || isNonnegativeNumber(value.tokensCacheWrite))
    && (value.costUsdMicros === undefined || isNonnegativeNumber(value.costUsdMicros))
    && (value.meta === undefined || isRecord(value.meta))
}

function validEntries(value: unknown): UsageEntry[] {
  return Array.isArray(value) ? value.filter(isUsageEntry) : []
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

function isByAgentRow(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.agent === 'string'
    && (value.attributed === undefined || typeof value.attributed === 'boolean')
    && (value.attributed !== false || value.agent === 'unknown')
    && isNonnegativeInteger(value.count)
    && isNonnegativeInteger(value.errors)
    && value.errors <= value.count
    && (value.lastActivity === null || isUsageEntry(value.lastActivity))
}

export function isAttributedAgentRow(row: UsageFeedData['byAgent'][number]): boolean {
  return row.attributed ?? row.agent !== 'unknown'
}

function validAgentRows(value: unknown): UsageFeedData['byAgent'] {
  return Array.isArray(value) ? value.filter(isByAgentRow) as UsageFeedData['byAgent'] : []
}

function boundedAgentRows(rows: UsageFeedData['byAgent']): UsageFeedData['byAgent'] {
  const attributed: UsageFeedData['byAgent'] = []
  const seen = new Set<string>()
  let unattributed: UsageFeedData['byAgent'][number] | undefined
  for (const row of rows) {
    if (!isAttributedAgentRow(row)) {
      unattributed ??= row
      continue
    }
    if (seen.has(row.agent) || attributed.length >= 10) continue
    seen.add(row.agent)
    attributed.push(row)
  }
  return [...attributed, ...(unattributed ? [unattributed] : [])]
}

function attributedAgentCount(rows: UsageFeedData['byAgent']): number {
  return new Set(rows.filter(isAttributedAgentRow).map((row) => row.agent)).size
}

function isCanceled(entry: UsageEntry): boolean {
  const terminalStatus = entry.meta?.terminalStatus ?? entry.meta?.turnTerminalStatus
  return entry.status === 'ok' && terminalStatus === 'aborted'
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
  value: unknown,
  requestedWindow: ActivityWindow,
): NormalizedActivityFeed {
  if (!value) return { data: null, compatibilityLimited: false }
  const current = usageFeedResponseSchema.safeParse(value)
  if (current.success) {
    return current.data.window === requestedWindow
      ? { data: current.data, compatibilityLimited: false }
      : { data: null, compatibilityLimited: false }
  }

  // Everything below this boundary exists only for a rolling deployment whose
  // server predates the canonical response. It deliberately projects partial
  // evidence instead of weakening the current route contract.
  const legacy = value as Partial<UsageFeedData>

  const recent = validEntries(legacy.recent)
  const recentFailures = validEntries(legacy.recentFailures)
  const recentUnverified = validEntries(legacy.recentUnverified)
  const validByAgent = validAgentRows(legacy.byAgent)
  const byAgent = boundedAgentRows(validByAgent)
  const projectedAgentCount = attributedAgentCount(validByAgent)
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
      agentCount: isNonnegativeInteger(legacy.agentCount) && legacy.agentCount <= total
        ? Math.max(legacy.agentCount, projectedAgentCount)
        : projectedAgentCount,
      byAgent,
      recent,
      recentFailures,
      recentUnverified,
      timeBuckets: Array.isArray(legacy.timeBuckets) ? legacy.timeBuckets.filter(isTimeBucket) : [],
    },
  }
}
