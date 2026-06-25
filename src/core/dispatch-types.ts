/**
 * Shared dispatch types. Pure type/interface declarations extracted from
 * dispatch.ts so the dispatch modules (prompts, board, context-blocks) and the
 * fire-path core share one set of definitions without import cycles. No runtime.
 */
import type { DispatchFailureKind } from './dispatch-failures'

export type DispatchTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  description?: string
  projectId?: string
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
  agentId: string
  taskId: string
  threadId: string
  startedAt: number
  /** Full send + settle chain; resolves when reconciliation has finished. */
  settled: Promise<void>
}

export type ConcurrencyGate = 'concurrency_cap' | 'agent_busy' | null
