/**
 * Schedule plugin type definitions.
 */

// ---------------------------------------------------------------------------
// Sidecar - Bakin-owned metadata for runtime cron jobs
// ---------------------------------------------------------------------------

export interface ScheduleSidecar {
  version: 1
  jobs: Record<string, BakinJobMeta>
}

/**
 * The schedule definition Bakin owns. Once a job is migrated off OpenClaw cron
 * (see cutover), this is the canonical source of when the job fires — the Bakin
 * scheduler reads `expr`/`tz` directly and never consults the runtime cron store.
 */
export interface ScheduleDef {
  /** 'cron' = recurring expression; 'at' = one-shot ISO instant (fires once,
   *  then the job auto-disables with a completed display state). The native
   *  snapshot types below still carry 'every' — that's read-only rendering
   *  of runtime-owned crons, never a Bakin schedule. */
  kind: 'cron' | 'at'
  expr: string
}

export interface BakinJobMeta {
  jobId: string
  /** Stable caller-owned id used when a runtime/provider generates a different job id. */
  logicalJobId?: string
  isBakinJob: boolean
  /** Bakin-owned schedule definition. Canonical once cut over from OpenClaw cron. */
  schedule?: ScheduleDef
  /** Bakin-owned enabled flag. Replaces the OpenClaw cron `enabled` for Bakin jobs. */
  enabled?: boolean
  source?: 'bakin' | 'runtime' | 'adopted'
  displayName?: string
  description?: string
  agentId?: string
  /** Team assignment (#189) — mutually exclusive with agentId; fired tasks
   * carry the team and dispatch resolves the member per occurrence. */
  teamId?: string
  owner?: string // agent who receives alerts/briefings (defaults to the main agent)
  requireTriage?: boolean // true = create task unassigned, owner triages first
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string // supports {date}, {agent}, {runNumber} vars
  paused?: boolean
  pauseUntil?: string // ISO date, auto-resume
  pauseReason?: string // 'manual' | 'auto-failures' | 'skip'
  skipNextN?: number
  skippedCount?: number
  allowOverlap?: boolean // false (default) = skip if prev task still active
  maxFailures?: number // consecutive failures before auto-pause (default 3)
  consecutiveFailures?: number
  tz?: string // IANA timezone (e.g. "America/Denver"), defaults to system tz
  createdAt: string
  updatedAt: string
  lastTaskId?: string
  // Run-level dedup lives in the execution ledger (cron_fires) — the legacy
  // processedRunIds/lastProcessedRunAt fields are seeded there once on boot.
  originalRuntimeCron?: {
    provider: string
    capturedAt: string
    snapshot: unknown
  }
}

// ---------------------------------------------------------------------------
// Runtime cron job shape, normalized for schedule display/merge logic.
// ---------------------------------------------------------------------------

export interface RuntimeCronJobSnapshot {
  id: string
  name: string
  schedule: {
    kind?: 'cron' | 'every' | 'at'
    type?: 'cron' | 'every' | 'at'
    expr?: string
    value?: string
    tz?: string
  }
  enabled: boolean
  delivery?: {
    mode: 'announce' | 'webhook' | 'none'
    url?: string
    token?: string
    channel?: string
  }
  payload?: Record<string, unknown>
  toolsAllow?: string[]
  toolsAllowMissing?: boolean
  createdAt?: string
  updatedAt?: string
  createdAtMs?: number
  updatedAtMs?: number
}

export interface RuntimeCronJobsSnapshot {
  version: number
  jobs: RuntimeCronJobSnapshot[]
}

// ---------------------------------------------------------------------------
// Merged view - runtime cron job + Bakin sidecar
// ---------------------------------------------------------------------------

export interface MergedJob {
  // From runtime cron
  id: string
  name: string
  schedule: { type: 'cron' | 'every' | 'at'; value: string; tz?: string }
  enabled: boolean
  delivery?: RuntimeCronJobSnapshot['delivery']
  source: 'bakin' | 'runtime' | 'adopted'
  canAdopt: boolean
  canRestoreNative: boolean

  // From Bakin sidecar (defaults applied)
  isBakinJob: boolean
  displayName: string
  description?: string
  agentId?: string
  /** Team assignment (#189). */
  teamId?: string
  owner: string
  requireTriage: boolean
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  toolsAllow?: string[]
  toolsAllowMissing?: boolean
  paused: boolean
  pauseUntil?: string
  pauseReason?: string
  skipNextN?: number
  skippedCount?: number
  allowOverlap: boolean
  maxFailures: number
  consecutiveFailures: number
  lastTaskId?: string

  tz?: string
  createdAt?: string

  // Computed
  humanSchedule: string
  nextRun?: string // ISO date
  lastRun?: RunEntry
}

// ---------------------------------------------------------------------------
// Run history from the runtime cron adapter.
// ---------------------------------------------------------------------------

export interface RunEntry {
  runId: string
  jobId: string
  timestamp: string
  status: 'success' | 'failure' | 'skipped' | 'pending'
  duration?: number
  error?: string
  taskId?: string // Bakin task created by this run
  skippedReason?: string // 'overlap' | 'paused' | 'auto-paused' | 'skip-count'
}

// ---------------------------------------------------------------------------
// NL schedule parsing
// ---------------------------------------------------------------------------

export interface ParseResult {
  cron: string
  human: string
  confidence: 'high' | 'medium' | 'low'
  source: 'deterministic' | 'llm' | 'raw'
  nextRuns: string[] // ISO dates
}

// ---------------------------------------------------------------------------
// Fire result (shape returned by runClaimedFire / fireScheduledRun)
// ---------------------------------------------------------------------------

export interface BridgeResult {
  ok: boolean
  taskId?: string
  error?: string
  skipped?: string // reason: 'overlap' | 'paused' | 'auto-paused' | 'skip-count' | 'not-bakin' | 'already-processed'
}
