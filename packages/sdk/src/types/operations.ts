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

/** True once an operation has settled; a finished view never changes again. */
export function isOperationFinished(status: OperationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
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

/**
 * How a client following one operation sees it: `expired` = the same boot no
 * longer has the record; `restarted` = the server's boot changed (outcome
 * unknown); `unreachable` = reads are failing and being retried.
 */
export type OperationPhase = 'loading' | 'live' | 'finished' | 'expired' | 'restarted' | 'unreachable'

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

/** `GET /api/operations/:id[?children=1]`. */
export interface OperationGetResponse {
  bootId: string
  operation: OperationView
  /** Present only when requested with `?children=1`. */
  children?: OperationView[]
}

/** Every 404 carries the server's boot id: same boot → expired, different → restarted. */
export interface OperationNotFoundResponse {
  bootId: string
  error: 'not_found'
}

/** `POST /api/operations/:id/cancel` — 202 cancelling, 409 not_cancellable/already_finished, 404 not_found. */
export interface OperationCancelResponse {
  bootId: string
  status: OperationCancelResult
}

// ---------------------------------------------------------------------------
// Plugin API (D19) — `ctx.operations`
// ---------------------------------------------------------------------------

export interface PluginOperationStartInput<B = unknown> {
  /** Stored as `<pluginId>:<kind>`. */
  kind: string
  title: string
  href?: string
  /** Kind + normalized inputs, stored as `<pluginId>:<fingerprint>`; an identical live request attaches. */
  fingerprint: string
  /**
   * Resources acquired before `run`, in canonical order. User plugins may name
   * only their own `<pluginId>:<name>` resources; the core resources are
   * reserved for core plugins.
   */
  resources?: string[]
  plan: OperationPlan
  /** The triggering request: its origin (web or cli) is carried onto the operation. Omit for background work (`system`). */
  request?: Request
  run: (op: OperationContext) => Promise<OperationOutcome<B>>
}

export interface PluginOperationsAPI {
  /** Registers and starts the operation; answer the route with this (202, or 200 when `attached`). */
  start<B>(input: PluginOperationStartInput<B>): Promise<OperationStartResponse>
  /** Resolves with the terminal view (for in-process callers that must wait). */
  await(operationId: string): Promise<OperationView>
}

// ---------------------------------------------------------------------------
// Quiet state (D4, D17) — pure, shared by the registry, the CLI and the UI
// ---------------------------------------------------------------------------

/** One row per stage kind. A stage's own `quiet` overrides its row. */
export const OPERATION_QUIET_THRESHOLDS: Record<OperationStageKind, OperationQuietThresholds> = {
  preparing: { quietMs: 10_000, stuckMs: 30_000 },
  downloading: { quietMs: 10_000, stuckMs: 30_000 },
  extracting: { quietMs: 15_000, stuckMs: 45_000 },
  verifying: { quietMs: 15_000, stuckMs: 45_000 },
  committing: { quietMs: 15_000, stuckMs: 45_000 },
  cleanup: { quietMs: 15_000, stuckMs: 45_000 },
  building: { quietMs: 30_000, stuckMs: 120_000 },
  installing: { quietMs: 30_000, stuckMs: 120_000 },
}

export interface OperationQuietState {
  state: 'progressing' | 'quiet' | 'stuck' | 'waiting' | 'idle'
  /** The active stage the state was judged against (absent when idle or waiting). */
  stageId?: string
  /** Time since the last measurable progress. */
  sinceProgressMs: number
}

/**
 * Judges a view from `lastProgressAt` alone — output and heartbeats never
 * reset it. Waiting is never quiet or stuck unless the holder is stale, and a
 * finished operation is idle.
 */
export function operationQuietState(view: Pick<OperationView, 'status' | 'stages' | 'lastProgressAt' | 'waitingFor'>, now: number): OperationQuietState {
  const sinceProgressMs = Math.max(0, now - Date.parse(view.lastProgressAt))
  if (view.status !== 'running' && view.status !== 'cancelling') return { state: 'idle', sinceProgressMs }
  if (view.waitingFor && !view.waitingFor.stale) return { state: 'waiting', sinceProgressMs }
  const active = view.stages.find((s) => s.status === 'active')
  const thresholds = active ? (active.quiet ?? OPERATION_QUIET_THRESHOLDS[active.kind]) : OPERATION_QUIET_THRESHOLDS.preparing
  const state = sinceProgressMs >= thresholds.stuckMs ? 'stuck' : sinceProgressMs >= thresholds.quietMs ? 'quiet' : 'progressing'
  return { state, stageId: active?.id, sinceProgressMs }
}
