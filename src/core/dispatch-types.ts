/**
 * Shared dispatch types. Pure type/interface declarations extracted from
 * dispatch.ts so the dispatch modules (prompts, board, context-blocks) and the
 * fire-path core share one set of definitions without import cycles. No runtime.
 */
import type { DispatchFailureKind } from './dispatch-failures'

/** `blockedReason` sentinel for EVERY team-routing block (#189, round-4
 * review) — dispatch-side resolver blocks, routing exhaustion, and
 * fire-time dangling teams alike. The schedule outcome check compares
 * against this exact value to exclude routing problems from auto-pause
 * failure counting; the human detail always rides the task log. Lives in
 * this leaf module so the schedule plugin can import it without pulling
 * the dispatch runtime graph. */
export const TEAM_ROUTING_BLOCK_REASON = 'team routing failed — re-assign this task'

/** `blockedReason` for a task blocked after EXHAUSTING billed routing
 * retries (round-5). Deliberately NOT excluded from the schedule outcome
 * check: repeated billed failures must count toward a job's auto-pause,
 * or a broken routing provider bills maxRetries calls per occurrence
 * forever. */
export const TEAM_ROUTING_EXHAUSTED_REASON = 'team routing failed repeatedly — check the routing provider, then re-assign'

export type DispatchTask = {
  id: string
  title: string
  agent?: string
  /** Requested team (#189) — resolved to a concrete agent before dispatch. */
  team?: string
  workflowId?: string
  description?: string
  projectId?: string
  /** Brand link (#419) — effective brand resolves lazily (own → ancestry → project). */
  brandId?: string
  availableAt?: string
  dependsOn?: string
  // Origin signals for per-turn model routing (present on the stored task).
  scheduleJobId?: string
  parentId?: string | null
  tags?: string[]
  log?: Array<{ timestamp: string; message?: string }>
}

export type DispatchColumns = {
  backlog: DispatchTask[]
  todo: DispatchTask[]
  inProgress: DispatchTask[]
  review: DispatchTask[]
  done: DispatchTask[]
  blocked: DispatchTask[]
  archived: DispatchTask[]
}

export type DispatchTaskSnapshot = {
  column: keyof DispatchColumns
  task: DispatchTask
}

export type DispatchEligibilityContext = {
  nowMs: number
  runtimeAgentIds: Set<string>
  completedTaskIds: Set<string>
  /**
   * Every task id present on the board, any column. When provided, a
   * dependsOn pointing at an id that exists nowhere (hard-deleted by
   * archiveOldTasks) is treated as satisfied instead of stranding the
   * dependent forever — surfaced via `danglingDependency` so callers log it.
   */
  knownTaskIds?: Set<string>
}

export type DispatchIneligibleReason = 'scheduled' | 'dependency' | 'agent'

export type DispatchEligibility =
  | { eligible: true; danglingDependency?: string }
  | { eligible: false; reason: DispatchIneligibleReason }

/** Diagnosis evidence persisted across ladder rungs (salvagedText stripped). */
export interface SessionDeathDiagnosisLite {
  reason: string
  sessionId?: string
  sessionStatus?: string
  completionBytes?: number
  outputTruncated?: boolean
  oversizedOutput?: boolean
  lastToolCall?: string
  detail?: string
}

/**
 * Recovery-ladder state for a task whose runtime session died. `stage` is
 * what the NEXT dispatch of this task must do: 'corrective' injects the
 * PREVIOUS ATTEMPT FAILED guidance, 'decomposition' replaces the work prompt
 * with split-into-subtasks instructions. Session deaths are deterministic —
 * they never enter the generic cooldown/retry loop.
 */
export interface SessionDeathState {
  stage: 'corrective' | 'decomposition'
  deaths: number
  lastDiagnosis: SessionDeathDiagnosisLite
  salvagedAssetIds: string[]
}

export interface FailureRecord {
  lastAttempt: number
  count: number
  kind: DispatchFailureKind
  sessionDeath?: SessionDeathState
}

export interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[]
  failedDispatches: Record<string, FailureRecord>
  /**
   * Legacy monotonic per-task dispatch counter. Seq minting moved to the
   * execution ledger (seq_watermarks seeded from this field once, by the
   * ledger's v1 migration). Kept read-only in the type so old state files
   * parse; never written again.
   */
  dispatchSeq?: Record<string, number>
}

export interface DispatchContinuationContext {
  completedDependency?: { id: string; title: string }
}

export interface DispatchRosterAgent {
  id: string
  role?: string
}

export interface InFlightTurn {
  /** Task marker (`taskId` or `taskId:stepId`) — a lookup FIELD, not the
   *  registry key: the key is threadId, so a superseded-then-refired marker
   *  yields two independent entries and a zombie settle can only ever
   *  release itself (same-agent-concurrency D3). */
  marker: string
  agentId: string
  taskId: string
  /** Nested-workflow child board task the step actually serves (differs from
   *  taskId, which is the top-level parent) — deleting EITHER aborts (#604). */
  childTaskId?: string
  threadId: string
  startedAt: number
  /** Full send + settle chain; resolves when reconciliation has finished. */
  settled: Promise<void>
  /** Cancels the turn (MessageArgs.signal); fired by delete/orphan-sweep. */
  abort: AbortController
  /** Stamped by abortTurnsForTask — makes the abort idempotent and gives the
   *  watchdog sweep its force-release grace anchor. */
  abortedAt?: number
  abortReason?: TurnAbortReason
}

export type TurnAbortReason = 'task-deleted' | 'orphan-sweep' | 'superseded'

/** Advisory registry view for the watchdog sweep and tests — no handles. */
export interface InFlightTurnSnapshot {
  marker: string
  agentId: string
  taskId: string
  childTaskId?: string
  threadId: string
  startedAt: number
  abortedAt?: number
}

export type ConcurrencyGate = 'concurrency_cap' | 'agent_busy' | null
