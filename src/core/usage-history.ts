/**
 * Usage-history scanner — walks runtime session transcripts (via the
 * adapter-neutral memory capability, read-only) and recomputes each changed
 * agent session's per-(day, model) token buckets into the durable usage store
 * (#359).
 *
 * Change detection is statEntry mtime+size vs the store's scan state;
 * unchanged files are never read. Every stable, valid recompute is an
 * absolute replace, so transcript rewrites and compaction converge without
 * inflating totals. A malformed or concurrently changing transcript preserves
 * the last complete rows and scan state, marks coverage partial, and lets the
 * sweep continue.
 */
import { createLogger } from './logger'
import type { AgentRuntimeAdapter, RuntimeMemoryEntryStat } from '@bakin/core/adapters/runtime'
import {
  replaceSessionUsage,
  getScanState,
  toLocalDayKey,
  normalizeSessionOrigin,
  type SessionDayUsage,
} from '@bakin/core/usage-history/store'
import { getSessionJsonlTierId, parseSessionUsageMessages, type SessionUsageCost } from './agent-usage'

const log = createLogger('usage-history')

export interface UsageScanReport {
  /** Sessions parsed + replaced this sweep. */
  scanned: number
  /** Sessions skipped because mtime+size were unchanged. */
  skipped: number
  /** Sessions that errored (logged); the sweep continued. */
  failed: number
  /** Whether transcript evidence was fully observed, including per-agent gaps. */
  coverage: UsageScanCoverage
}

export type UsageScanCoverageStatus = 'complete' | 'partial' | 'unavailable'

export type UsageScanCoverageReason =
  | 'complete'
  | 'missing_session_tier'
  | 'roster_unavailable'
  | 'agent_scan_failed'
  | 'scan_failed'

export interface UsageAgentScanCoverage {
  agent: string
  status: Extract<UsageScanCoverageStatus, 'complete' | 'partial'>
}

export interface UsageScanCoverage {
  status: UsageScanCoverageStatus
  reason: UsageScanCoverageReason
  agents: UsageAgentScanCoverage[]
}

function sameEntryGeneration(
  before: RuntimeMemoryEntryStat | null,
  after: RuntimeMemoryEntryStat | null,
): boolean {
  if (!before || !after) return before === after
  return before.mtimeMs === after.mtimeMs && before.size === after.size
}

/**
 * One message's runtime-reported cost in dollars: explicit total wins, else
 * the sum of reported components — the same precedence the latest-session
 * card uses. The parser separately marks whether that subtotal covers every
 * positive token component. Null when nothing was reported.
 */
function messageCostUsd(cost: SessionUsageCost | null): number | null {
  if (!cost) return null
  if (typeof cost.total === 'number' && Number.isFinite(cost.total)) return cost.total
  const parts = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  if (parts.length === 0) return null
  return parts.reduce((sum, v) => sum + v, 0)
}

function costUsdToMicros(costUsd: number): number {
  const micros = Math.round(costUsd * 1_000_000)
  if (!Number.isSafeInteger(micros) || micros < 0) {
    throw new Error('session usage cost exceeded the safe micro-dollar range')
  }
  return micros
}

/** Recompute a session's (day, model) buckets from its parsed messages. */
export function bucketSessionUsage(content: string): SessionDayUsage[] {
  const parsed = parseSessionUsageMessages(content)
  if (parsed.integrity.status === 'partial') {
    throw new Error(
      `session transcript contains ${parsed.integrity.malformedLines} invalid ${parsed.integrity.malformedLines === 1 ? 'line' : 'lines'}`,
    )
  }
  const { sessionStarted, messages } = parsed
  const sessionStartMs = sessionStarted ? Date.parse(sessionStarted) : NaN

  const buckets = new Map<string, SessionDayUsage>()
  let latestBucket: SessionDayUsage | null = null
  for (const msg of messages) {
    const tsMs = msg.tsMs ?? (Number.isFinite(sessionStartMs) ? sessionStartMs : null)
    if (tsMs === null) {
      throw new Error('session usage message has no attributable timestamp')
    }

    const day = toLocalDayKey(tsMs)
    const key = `${day}\0${msg.model}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        day,
        model: msg.model,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
        costUsdMicros: null,
        costedMessages: 0,
        messageCount: 0,
        userMessages: 0,
        firstTs: tsMs,
        lastTs: tsMs,
      }
      buckets.set(key, bucket)
    }
    if (latestBucket === null || tsMs >= latestBucket.lastTs) latestBucket = bucket

    bucket.inputTokens += msg.tokens.input
    bucket.outputTokens += msg.tokens.output
    bucket.cacheReadTokens += msg.tokens.cacheRead
    bucket.cacheWriteTokens += msg.tokens.cacheWrite
    bucket.totalTokens += msg.tokens.total
    const tokenCounts = [
      bucket.inputTokens,
      bucket.outputTokens,
      bucket.cacheReadTokens,
      bucket.cacheWriteTokens,
      bucket.totalTokens,
    ]
    if (!tokenCounts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('session usage token total exceeded the safe integer range')
    }
    bucket.messageCount += 1
    bucket.userMessages += msg.userMessages
    bucket.firstTs = Math.min(bucket.firstTs, tsMs)
    bucket.lastTs = Math.max(bucket.lastTs, tsMs)

    const costUsd = messageCostUsd(msg.cost)
    if (costUsd !== null) {
      const nextCostUsdMicros = (bucket.costUsdMicros ?? 0) + costUsdToMicros(costUsd)
      if (!Number.isSafeInteger(nextCostUsdMicros) || nextCostUsdMicros < 0) {
        throw new Error('session usage cost exceeded the safe micro-dollar range')
      }
      bucket.costUsdMicros = nextCostUsdMicros
      if (msg.costComplete) bucket.costedMessages += 1
    }
  }

  // User turns after the last usage-bearing assistant message still count as
  // interaction evidence; they attribute to the session's latest bucket.
  if (latestBucket && parsed.trailingUserMessages > 0) {
    latestBucket.userMessages += parsed.trailingUserMessages
  }

  return [...buckets.values()]
}

/**
 * Sweep every agent's session transcripts into the usage store. Safe to run
 * repeatedly (idempotent); intended to be driven by the health plugin's
 * interval timer, never at boot.
 */
export async function scanUsageHistory(runtime: AgentRuntimeAdapter): Promise<UsageScanReport> {
  const report: UsageScanReport = {
    scanned: 0,
    skipped: 0,
    failed: 0,
    coverage: { status: 'unavailable', reason: 'missing_session_tier', agents: [] },
  }

  const tierId = await getSessionJsonlTierId(runtime)
  if (!tierId) return report

  let agents
  try {
    agents = await runtime.agents.list()
  } catch (err) {
    log.warn('usage scan: cannot list agents', { error: err instanceof Error ? err.message : String(err) })
    report.coverage.reason = 'roster_unavailable'
    return report
  }

  report.coverage = {
    status: 'complete',
    reason: 'complete',
    agents: agents.map((agent) => ({ agent: agent.id, status: 'complete' })),
  }

  for (const [agentIndex, agent] of agents.entries()) {
    const markAgentPartial = () => {
      report.coverage.agents[agentIndex]!.status = 'partial'
      report.coverage.status = 'partial'
      report.coverage.reason = 'agent_scan_failed'
    }
    let entries
    try {
      entries = await runtime.memory.listEntries(tierId, { agentId: agent.id })
    } catch (err) {
      log.warn('usage scan: cannot list sessions', { agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
      report.failed++
      markAgentPartial()
      continue
    }

    for (const entry of entries) {
      if (entry.id.includes('.deleted') || entry.path?.includes('.deleted')) continue
      try {
        const statBefore = await runtime.memory.statEntry(tierId, entry.id, { agentId: agent.id })
        const prev = getScanState(entry.id, agent.id)
        if (statBefore) {
          if (prev && prev.mtimeMs === statBefore.mtimeMs && prev.size === statBefore.size) {
            report.skipped++
            continue
          }
        }

        const full = await runtime.memory.getEntry(tierId, entry.id, { agentId: agent.id })
        if (!full) {
          report.failed++
          markAgentPartial()
          continue
        }

        const statAfter = await runtime.memory.statEntry(tierId, entry.id, { agentId: agent.id })
        if (!sameEntryGeneration(statBefore, statAfter)) {
          throw new Error('session transcript changed while it was being read')
        }

        // The content read and the surrounding stats must describe one stable
        // generation. UTF-8 bytes keep the comparison aligned with filesystem
        // stat and the durable scan state.
        const contentSize = Buffer.byteLength(full.content, 'utf-8')
        if (statAfter && contentSize !== statAfter.size) {
          throw new Error('session transcript content did not match its stable file generation')
        }
        const rows = bucketSessionUsage(full.content)
        const ok = replaceSessionUsage(entry.id, agent.id, rows, {
          mtimeMs: statAfter?.mtimeMs ?? 0,
          size: contentSize,
        }, normalizeSessionOrigin(entry.metadata?.origin))
        if (ok) report.scanned++
        else {
          report.failed++
          markAgentPartial()
        }
      } catch (err) {
        report.failed++
        markAgentPartial()
        log.warn('usage scan: session failed', { agentId: agent.id, sessionId: entry.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return report
}
