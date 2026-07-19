/**
 * Wire-format types for the health plugin's dashboard endpoints.
 *
 * Extracted from components/health-page.tsx (which previously declared these
 * inline, the missing-types.ts convention violation the tasks/models plugins
 * don't have). Both the page component and plugins/health/index.ts can now type
 * their route payloads against one set of contracts.
 */
import type {
  InteractionCoverage as CanonicalInteractionCoverage,
  UsageEntry as CanonicalUsageEntry,
  UsageFeedResponse,
  UsageKind as CanonicalUsageKind,
} from './lib/usage-feed-route-schema'
import type {
  InteractionCategory as CanonicalInteractionCategory,
  InteractionSummaryResponse,
} from './lib/interaction-summary-route-schema'
import type {
  SearchStatusResponse,
  SearchTelemetryResponse,
} from './lib/system-route-schemas'
import type { HealthLiveSummaryClient } from './lib/route-schemas'

export type UsageKind = CanonicalUsageKind
export type UsageEntry = CanonicalUsageEntry

type CanonicalTopByNameRow = UsageFeedResponse['topByName'][number]
export type TopByNameRow = Omit<CanonicalTopByNameRow, 'kind' | 'method'>
  & Partial<Pick<CanonicalTopByNameRow, 'kind' | 'method'>>

type CanonicalByAgentRow = UsageFeedResponse['byAgent'][number]
export type ByAgentRow = Omit<CanonicalByAgentRow, 'attributed'>
  & Partial<Pick<CanonicalByAgentRow, 'attributed'>>

export type UsageOutcomeCounts = UsageFeedResponse['outcomes']
export type UsageKindSummary = UsageFeedResponse['byKind'][number]

type CanonicalUsageFailureGroup = UsageFeedResponse['failureGroups'][number]
export type UsageFailureGroup = Omit<
  CanonicalUsageFailureGroup,
  'destination' | 'method' | 'latestFailure'
> & Partial<Pick<CanonicalUsageFailureGroup, 'destination' | 'method' | 'latestFailure'>>

export type UsageFailureGroupPage = UsageFeedResponse['failureGroupPage']

/**
 * Activity's normalized presentation shape. Current responses are defined by
 * `usageFeedResponseSchema`; the optional fields here exist only for the
 * explicitly isolated rolling-version adapter.
 */
export type UsageFeedData = Omit<
  UsageFeedResponse,
  'capabilities' | 'failureGroups' | 'failureGroupPage' | 'topByName' | 'agentCount' | 'byAgent'
> & {
  /** Additive server features; omitted by older strict servers. */
  capabilities?: {
    [Key in keyof UsageFeedResponse['capabilities']]?: boolean
  }
  failureGroups: UsageFailureGroup[]
  /** Present on the bounded v2 feed; omitted only by compatibility projections. */
  failureGroupPage?: UsageFailureGroupPage
  topByName: TopByNameRow[]
  /** Exact distinct attributed-agent count; older servers may omit it. */
  agentCount?: number
  /** Bounded busiest-agent projection, with an optional unattributed row. */
  byAgent: ByAgentRow[]
}

export type InteractionCategory = CanonicalInteractionCategory
export type InteractionCoverageReason = CanonicalInteractionCoverage['reason']
export type InteractionCoverage = CanonicalInteractionCoverage
export type InteractionSummaryData = InteractionSummaryResponse

export type HealthSummary = HealthLiveSummaryClient

// --- Search health (blue/green index status) -------------------------------
// Promoted from the inline shape the health page previously declared in-place,
// so the page component and /search-status route type against one contract.

// Canonical shapes live in the SDK (services.ts) — re-exported here so the
// page component and /search-status route keep one import site. The old
// local duplicate drifted the moment the SDK gained freshness fields.
export type { SearchHealthIndex as SearchHealthLeg, SearchHealthTable } from '@makinbakin/sdk'

export type SearchHealthData = SearchStatusResponse
export type SearchTelemetryWindow = SearchTelemetryResponse['windows']['1h']
export type SearchEnrichmentCoverage = NonNullable<
  NonNullable<SearchTelemetryResponse['enrichment']>['coverage']
>
export type SearchTelemetryData = Pick<
  SearchTelemetryResponse,
  'windows' | 'outbox' | 'enrichment' | 'enrichmentEvidence'
>

export interface MeteredSpendData {
  totalUsdMicros: number
  byAgent: Array<{ agent: string; costUsdMicros: number; runs: number }>
  /** Cap-window pace projections (cost-control v2) — null until enough of the window elapsed. */
  pace?: {
    daily: { meteredUsdMicros: number | null; subscriptionTokens: number | null; endsMs: number }
    monthly: { meteredUsdMicros: number | null; subscriptionTokens: number | null; endsMs: number }
  }
}

// ─── Usage history (GET /usage-history, #359) ────────────────────────────────

export type UsageHistoryWindow = '24h' | '7d' | '30d'

export interface UsageHistoryTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface UsageHistoryRollup {
  tokens: UsageHistoryTokens
  /** Runtime-reported cost sum (micro-dollars); null when none reported. */
  costUsdMicros: number | null
  /** Cost coverage: messages that carried runtime-reported cost / all messages. */
  costedMessages: number
  messageCount: number
}

export type UsageEvidenceCoverageStatus = 'complete' | 'partial' | 'unavailable'

export type UsageEvidenceCoverageReason =
  | 'complete'
  | 'scan_not_run'
  | 'scan_in_progress'
  | 'scan_status_unavailable'
  | 'missing_session_tier'
  | 'roster_unavailable'
  | 'agent_scan_failed'
  | 'scan_failed'
  | 'scan_stale'

export interface UsageEvidenceCoverage {
  status: UsageEvidenceCoverageStatus
  reason: UsageEvidenceCoverageReason
  agents: Array<{
    agent: string
    status: Extract<UsageEvidenceCoverageStatus, 'complete' | 'partial'>
  }>
}

export interface UsageHistoryData {
  window: UsageHistoryWindow
  /** First local calendar day (YYYY-MM-DD) included — windows are day-aligned. */
  since: string
  /** Current local calendar day (YYYY-MM-DD); its rollup is still in progress. */
  throughDay: string
  /** ISO time of the last completed scan; null before the first sweep. */
  scannedAt: string | null
  /**
   * Transcript-scan completeness. Optional so a newer UI can still consume
   * an older Health plugin response; absence must be treated conservatively.
   */
  coverage?: UsageEvidenceCoverage
  byAgent: Array<UsageHistoryRollup & { agent: string }>
  byDay: Array<UsageHistoryRollup & { day: string }>
  /** (agent × day) cells — the per-agent stacked chart series (#385). */
  byAgentDay: Array<UsageHistoryRollup & { agent: string; day: string }>
}

// ─── Live-now (GET /live-now, #385) ──────────────────────────────────────────

export interface LiveRunEntry {
  agent: string
  taskId: string
  /** Task title when the task still exists; null for freshly purged tasks. */
  taskTitle: string | null
  runId: string
  startedAt: number
  runningForMs: number
  heartbeatAgeMs: number
}

export interface LiveNowData {
  runs: LiveRunEntry[]
  generatedAt: string
}

// ─── Agent effort (GET /agent-effort, #385) ──────────────────────────────────

export type AgentEffortWindow = '24h' | '7d' | '30d'

export type AgentEffortFlag =
  | { kind: 'effort-no-outcome' | 'spike'; message: string }
  /** Legacy server generations only (pre-#691). */
  | { kind: 'unattributed'; message: string }
  | { kind: 'interactive'; message: string; tokens: number }
  | { kind: 'unexplained'; message: string; tokens: number; spikeConcurrent: boolean }
  | {
      kind: 'runaway'
      message: string
      sessions: Array<{ sessionId: string; tokens: number; assistantTurns: number }>
      scheduledJobs: string[]
      downgraded: boolean
    }

export interface AgentEffortRow {
  agent: string
  /** Bakin-attributed tokens; null when any token-bearing call lacks token evidence. */
  windowTokens: number | null
  /** Null when no run was recorded or any recorded run lacks tracked cost. */
  windowCostUsdMicros: number | null
  runs: number
  /** Token-bearing calls; media work is excluded. Present on current servers. */
  tokenApplicableRuns?: number
  /** Present on current servers; omitted by legacy servers. */
  tokenMeteredRuns?: number
  /** False when reported token totals cannot be safely represented as one aggregate. */
  tokenAggregateRepresentable?: boolean
  /** Present on current servers; omitted by legacy servers. */
  costedRuns?: number
  /** False when reported costs cannot be safely represented as one aggregate. */
  costAggregateRepresentable?: boolean
  completions: number
  tokensPerCompletion: number | null
  /** Transcript-observed tokens; null when the usage scanner has no coverage. */
  totalObservedTokens: number | null
  /** Legacy server generations only (pre-#691 single delta). */
  unattributedTokens?: number | null
  /** Interactive (external-origin session) tokens; absent on legacy servers. */
  interactiveTokens?: number | null
  /** Unexplained (bakin/unknown-origin minus attributed) tokens; absent on legacy servers. */
  unexplainedTokens?: number | null
  flags: AgentEffortFlag[]
}

export interface AgentEffortData {
  window: AgentEffortWindow
  /** Exact local calendar-day scope; optional for compatibility with older servers. */
  since?: string
  throughDay?: string
  scopeLabel?: string
  /** ISO time of the last usage scan; observed columns are only as fresh as this. */
  scannedAt: string | null
  /** Same transcript evidence snapshot used for observed/unattributed fields. */
  coverage?: UsageEvidenceCoverage
  agents: AgentEffortRow[]
}

// ─── Startup-context summary (GET /api/context-report) ──────────────────────

export interface ContextSummaryObserved {
  inputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  occurredAt: number
}

export interface ContextSummaryAgent {
  agentId: string
  staticTaskBytes: number
  staticWorkflowBytes: number
  estimatedMaxTaskBytes: number
  workspaceAvailable: boolean
  workspaceTotalBytes: number
  lastObserved: ContextSummaryObserved | null
}

export interface ContextSummaryData {
  ok: true
  tokenEstimateNote: string
  agents: ContextSummaryAgent[]
}

export interface ContextSettingsData {
  dispatch?: { contextBudgetBytes?: number }
}
