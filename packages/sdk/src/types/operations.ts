/**
 * Operations — the one progress contract for every long-running flow (#895).
 *
 * An operation is a server-side unit of work with a plan declared up front
 * (fixed stage kinds), measurable progress tracked separately from liveness,
 * an explicit outcome, and a boot-scoped identity. The registry
 * (`@bakin/core/operations`) owns the lifecycle; installers report only
 * through an `OperationContext`; clients render complete `OperationView`s.
 *
 * Deep reference: `.claude/knowledge/operations.md`.
 */

/** The fixed stage vocabulary. Waiting is an overlay (`waitingFor`), never a stage. */
export const OPERATION_STAGE_KINDS = [
  'preparing',
  'downloading',
  'extracting',
  'building',
  'installing',
  'verifying',
  'committing',
  'cleanup',
] as const
export type OperationStageKind = (typeof OPERATION_STAGE_KINDS)[number]

export type OperationStatus = 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
export type OperationStageStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'
/** Who started it — drives attention routing (toast, OS notification, Discord). */
export type OperationOrigin = 'web' | 'cli' | 'discord' | 'system'
/** Whose code runs it — separate from `origin`. */
export type OperationOwner = 'core' | `plugin:${string}`

/** The three core resources, acquired in this canonical order. */
export const CORE_RESOURCES = ['install-state', 'media-store', 'search-engine'] as const
export type CoreResource = (typeof CORE_RESOURCES)[number]

export interface OperationQuietThresholds {
  quietMs: number
  stuckMs: number
}

export interface OperationStagePlan {
  id: string
  kind: OperationStageKind
  label: string
  /** Overrides the per-kind threshold row for this stage. */
  quiet?: OperationQuietThresholds
}

export interface OperationPlan {
  stages: OperationStagePlan[]
  /**
   * The first stage that changes anything outside staging. Cancel is refused
   * once it starts. `'start'` = never cancellable; `null` = cancellable
   * throughout (nothing live changes until an atomic publish at the end).
   */
  pointOfNoReturn: string | 'start' | null
}

export interface OperationBytes {
  received: number
  /** `null` = size unknown (the UI says so and shows an indeterminate bar). */
  total: number | null
}

export interface OperationItem {
  id: string
  label: string
  status: OperationStageStatus
  bytes?: OperationBytes
  message?: string
}

export type OperationAttemptReason = 'stalled' | 'deadline' | 'http' | 'network'

export interface OperationAttempt {
  n: number
  of: number
  reason: OperationAttemptReason
  detail?: string
}

export interface OperationStageView extends OperationStagePlan {
  status: OperationStageStatus
  startedAt?: string
  endedAt?: string
  message?: string
  /** Per-item status; several items may be active at once. */
  items?: OperationItem[]
  bytes?: OperationBytes
  attempt?: OperationAttempt
  skippedReason?: string
}

export interface OperationWaitingFor {
  holderTitle: string
  holderOperationId?: string
  since: string
  /** The holder is dead or unknown and is being reclaimed. */
  stale?: boolean
}

export interface OperationOutcomeSummary {
  code: string
  message?: string
  partiallyApplied?: boolean
}

export type OperationLogLevel = 'info' | 'warn' | 'error'

export interface OperationLogEntry {
  at: string
  level: OperationLogLevel
  stageId?: string
  text: string
}

/** The complete view. Every event and every read carries one of these. */
export interface OperationView<B = unknown> {
  id: string
  parentId?: string
  children: string[]
  /** Monotonic per operation; a client keeps the highest rev within one boot. */
  rev: number
  bootId: string
  kind: string
  owner: OperationOwner
  origin: OperationOrigin
  title: string
  href?: string
  fingerprint: string
  resources: string[]
  status: OperationStatus
  plan: OperationPlan
  stages: OperationStageView[]
  waitingFor?: OperationWaitingFor
  cancellable: boolean
  startedAt: string
  /** Moves only on measurable advancement. Parent: max over its stages and children. */
  lastProgressAt: string
  /** Moves on output and heartbeats. Displayed; never resets quiet or stuck. */
  lastLivenessAt: string
  lastOutput?: string
  endedAt?: string
  outcome?: OperationOutcomeSummary
  result?: { httpStatus: number; body: B }
  /** The tail of the activity log (the registry keeps the last 100 lines). */
  log: OperationLogEntry[]
}

/** Everything an installer may do. It never broadcasts and never takes locks. */
export interface OperationContext {
  readonly id: string
  /** Aborted on cancel (only before the point of no return). */
  readonly signal: AbortSignal
  stage(stageId: string, message?: string): void
  item(stageId: string, item: Omit<OperationItem, 'status'> & { status?: OperationStageStatus }): void
  bytes(stageId: string, bytes: OperationBytes, itemId?: string): void
  attempt(stageId: string, attempt: OperationAttempt): void
  /** Liveness and log only — output is never progress. */
  output(line: string): void
  log(text: string, level?: OperationLogLevel): void
  skip(stageId: string, reason: string): void
  /** Raises the cancellation error when cancelled before the point of no return. */
  throwIfCancelled(): void
  /** True when this operation holds `resource` (inner writers assert ownership). */
  holds(resource: string): boolean
}

export interface OperationOutcome<B = unknown> {
  status: 'succeeded' | 'failed'
  /** `'ok'`, `'awaiting_consent'`, `'verification_failed'`, `'partially_applied'`, … */
  code: string
  message?: string
  httpStatus: number
  body: B
}

/** The body of a converted route's 202 (or 200 when attached to a live twin). */
export interface OperationStartResponse {
  operationId: string
  bootId: string
  attached?: true
}

export type OperationCancelResult = 'cancelling' | 'not_cancellable' | 'not_found' | 'already_finished'

/** `GET /api/operations`. */
export interface OperationListResponse {
  bootId: string
  operations: OperationView[]
}
