/**
 * Per-agent activity timeline assembly (#385) — the run spine (dispatch
 * attempts with tokens/cost from the execution ledger) interleaved with
 * notable audit events, newest first. Pure merge logic so the route, the CLI
 * report, and tests share one implementation.
 *
 * Reads Bakin-owned stores only (ledger rows, audit entries, task logs) —
 * session-death detail comes from the audit payload written at dispatch time,
 * never from fresh transcript parsing.
 */
import type { RunWithCostRow } from '../../../src/core/execution-ledger'
import type { AuditEvent } from '../../../src/core/audit'
import { mapAuditMessage } from '../../../src/lib/map-audit-message'
import type { TaskLogEntry } from '@makinbakin/sdk/types'

/** Audit kinds worth interleaving into the timeline. */
export const TIMELINE_AUDIT_KINDS = [
  'task.routed',
  'task.bypass_detected',
  'task.runtime_session_died',
  'task.runtime_failed_blocked',
  'task.corrective_redispatch',
  'task.decomposition_dispatched',
  'task.blocked',
  'task.worktree_materialized',
  'task.repo_binding_blocked',
  'agent_pkg.lessons_retrieved',
  'agent_pkg.lessons_retrieval_failed',
] as const

const WARN_KINDS = new Set([
  'task.bypass_detected',
  'task.runtime_session_died',
  'task.runtime_failed_blocked',
  'task.blocked',
  'agent_pkg.lessons_retrieval_failed',
])

export const TIMELINE_MAX_RUNS = 100
export const TIMELINE_MAX_EVENTS = 200
const MAX_LOGS_PER_RUN = 20

export interface TimelineRunEvent {
  type: 'run'
  ts: number
  runId: string
  taskId: string
  taskTitle: string | null
  seq: number
  status: 'running' | 'settled' | 'superseded' | 'lost'
  settleReason: string | null
  startedAt: number
  settledAt: number | null
  durationMs: number | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  costUsdMicros: number | null
  /** Route receipt: work performed + how the model was chosen (null = pre-migration). */
  workClass: string | null
  routeSource: string | null
  /** Progress-log lines written during this run (capped, oldest first). */
  logs: Array<{ ts: string; message: string }>
  logsTruncated: boolean
}

export interface TimelineAuditEntry {
  type: 'event'
  ts: number
  event: string
  severity: 'info' | 'warn'
  message: string
  taskId: string | null
}

export type TimelineEvent = TimelineRunEvent | TimelineAuditEntry

export interface TimelineTaskInfo {
  title: string
  log: TaskLogEntry[]
}

/** Plain-language summary for a session-death audit payload. */
function summarizeDeath(event: string, data: Record<string, unknown>): string {
  const reason = data.reason === 'runtime_timeout' ? 'runtime timeout' : 'session interrupted'
  const parts = [`Session died (${reason})`]
  if (typeof data.title === 'string' && data.title) parts.push(`during '${data.title}'`)
  if (typeof data.lastToolCall === 'string' && data.lastToolCall) parts.push(`— last tool: ${data.lastToolCall}`)
  if (typeof data.deaths === 'number' && data.deaths > 1) parts.push(`(death ${data.deaths})`)
  if (event === 'task.runtime_failed_blocked') parts.push('— task blocked for diagnosis')
  if (typeof data.salvagedAssetId === 'string') parts.push(`— partial output salvaged as asset ${data.salvagedAssetId}`)
  return parts.join(' ')
}

function humanize(entry: AuditEvent): string {
  if (entry.event === 'task.runtime_session_died' || entry.event === 'task.runtime_failed_blocked') {
    return summarizeDeath(entry.event, entry.data)
  }
  // Kinds mapAuditMessage has no sentence for (it echoes the event name).
  if (entry.event === 'task.bypass_detected') {
    const pattern = typeof entry.data.pattern === 'string' ? ` (matched "${entry.data.pattern}")` : ''
    return `Bypassed the preferred tool path${pattern} — check the task's output route`
  }
  if (entry.event === 'agent_pkg.lessons_retrieved') {
    const count = Array.isArray(entry.data.lessons) ? entry.data.lessons.length : undefined
    return `Retrieved ${count !== undefined ? `${count} ` : ''}lesson(s) for this dispatch`
  }
  if (entry.event === 'agent_pkg.lessons_retrieval_failed') {
    return 'Lesson retrieval failed for this dispatch'
  }
  return mapAuditMessage(entry.event, entry.data)
}

/**
 * Merge runs and audit events into one newest-first stream and attach each
 * run's progress-log lines (entries timestamped inside the run's lifetime).
 */
export function assembleTimeline(inputs: {
  runs: RunWithCostRow[]
  auditEvents: AuditEvent[]
  taskById: Map<string, TimelineTaskInfo>
  now?: number
}): TimelineEvent[] {
  const now = inputs.now ?? Date.now()

  const runEvents: TimelineRunEvent[] = inputs.runs.slice(0, TIMELINE_MAX_RUNS).map((run) => {
    const task = inputs.taskById.get(run.taskId)
    const windowEnd = run.settledAt ?? now
    const inRun = (task?.log ?? []).filter((entry) => {
      const t = Date.parse(entry.timestamp)
      return !Number.isNaN(t) && t >= run.startedAt && t <= windowEnd
    })
    return {
      type: 'run',
      ts: run.startedAt,
      runId: run.runId,
      taskId: run.taskId,
      taskTitle: task?.title ?? null,
      seq: run.seq,
      status: run.status,
      settleReason: run.settleReason,
      startedAt: run.startedAt,
      settledAt: run.settledAt,
      durationMs: run.settledAt !== null ? Math.max(0, run.settledAt - run.startedAt) : null,
      model: run.model,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      totalTokens: run.totalTokens,
      costUsdMicros: run.costUsdMicros,
      workClass: run.workClass,
      routeSource: run.routeSource,
      logs: inRun.slice(0, MAX_LOGS_PER_RUN).map((e) => ({ ts: e.timestamp, message: e.message })),
      logsTruncated: inRun.length > MAX_LOGS_PER_RUN,
    }
  })

  const auditEntries: TimelineAuditEntry[] = inputs.auditEvents
    .slice(-TIMELINE_MAX_EVENTS)
    .map((entry) => {
      const ts = Date.parse(entry.ts)
      return {
        type: 'event' as const,
        ts: Number.isNaN(ts) ? 0 : ts,
        event: entry.event,
        severity: WARN_KINDS.has(entry.event) ? ('warn' as const) : ('info' as const),
        message: humanize(entry),
        taskId:
          typeof entry.data.taskId === 'string'
            ? entry.data.taskId
            : typeof entry.data.id === 'string'
              ? entry.data.id
              : null,
      }
    })
    .filter((entry) => entry.ts > 0)

  return [...runEvents, ...auditEntries].sort((a, b) => b.ts - a.ts)
}
