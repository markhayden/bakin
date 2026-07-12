/**
 * Wire-format types for the health plugin's dashboard endpoints.
 *
 * Extracted from components/health-page.tsx (which previously declared these
 * inline, the missing-types.ts convention violation the tasks/models plugins
 * don't have). Both the page component and plugins/health/index.ts can now type
 * their route payloads against one set of contracts.
 */
import type { HealthCheckResult } from '@makinbakin/sdk'

export interface McpSessionInfo {
  agent: string
  sessions: number
  connectedAt: string
}

export interface DoctorData {
  results: HealthCheckResult[]
  summary: { total: number; errors: number; warnings: number }
  cachedAt?: string
}

export interface ServerData {
  port: number
  pid: number
  nodeVersion: string
  memoryMB: number
  totalMemoryMB: number
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  latestVersion?: string | null
  description: string
  source: 'built-in' | 'user'
  routes: number
  installed?: {
    version?: string
    commitSha?: string
    remoteHeadSha?: string
    lastChecked?: string
    newPermissions?: string[]
  } | null
  upgradeAvailable?: boolean
  staleHintDays?: number | null
}

export interface RegistryData {
  plugins: PluginInfo[]
}

export interface PluginManifestEntry {
  id: string
  name: string
  version: string
  latestVersion?: string | null
  source: 'core' | 'github' | 'local'
  installed: PluginInfo['installed']
  upgradeAvailable: boolean
  staleHintDays: number | null
}

export interface PluginManifestData {
  plugins: PluginManifestEntry[]
}

export interface ErrorsByKind {
  total: number
  byKind: { mcp: number; rest: number; agent: number }
}

export type UsageKind = 'mcp' | 'rest' | 'agent'

export interface UsageEntry {
  ts: string
  kind: UsageKind
  name: string
  agent: string | null
  durationMs: number | null
  status: 'ok' | 'error'
  meta?: Record<string, unknown>
}

export interface TopByNameRow {
  name: string
  count: number
  errors: number
  medianDurationMs: number | null
}

export interface ByAgentRow {
  agent: string
  count: number
  errors: number
  lastActivity: UsageEntry | null
}

export interface UsageFeedData {
  totals: { count: number; errors: number; errorRate: number }
  topByName: TopByNameRow[]
  byAgent: ByAgentRow[]
  recent: UsageEntry[]
}

export interface HealthSummary {
  doctor: DoctorData | null
  errors1h: ErrorsByKind | null
  activeSessions: McpSessionInfo[] | null
  upSince: string | null
  server: ServerData | null
}

// --- Search health (blue/green index status) -------------------------------
// Promoted from the inline shape the health page previously declared in-place,
// so the page component and /search-status route type against one contract.

// Canonical shapes live in the SDK (services.ts) — re-exported here so the
// page component and /search-status route keep one import site. The old
// local duplicate drifted the moment the SDK gained freshness fields.
import type { SearchHealthTable as SdkSearchHealthTable } from '@makinbakin/sdk'
export type { SearchHealthIndex as SearchHealthLeg, SearchHealthTable } from '@makinbakin/sdk'

export interface SearchHealthData {
  enabled: boolean
  outbox?: { pending: number; quarantined: number; oldestPendingAt: number | null }
  tables: SdkSearchHealthTable[]
}

export interface SearchTelemetryWindow {
  query: { count: number; errors: number; medianMs: number | null }
  drain: { count: number; errors: number }
  enrich: { count: number; errors: number }
}

export interface SearchEnrichmentCoverage {
  total: number
  enriched: number
  missing: number
  stale: number
  failed: number
  skipped: number
}

export interface SearchTelemetryData {
  windows: Record<'1h' | '24h', SearchTelemetryWindow>
  outbox: { pending: number; quarantined: number }
  enrichment: {
    depth?: number
    running?: number
    failedRecent?: number
    coverage?: SearchEnrichmentCoverage
  } | null
}

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

export interface UsageHistoryData {
  window: UsageHistoryWindow
  /** First local calendar day (YYYY-MM-DD) included — windows are day-aligned. */
  since: string
  /** ISO time of the last completed scan; null before the first sweep. */
  scannedAt: string | null
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

export interface AgentEffortFlag {
  kind: 'effort-no-outcome' | 'spike' | 'unattributed'
  message: string
}

export interface AgentEffortRow {
  agent: string
  /** Bakin-attributed tokens in the window (execution ledger). */
  windowTokens: number
  windowCostUsdMicros: number | null
  runs: number
  completions: number
  tokensPerCompletion: number | null
  /** Transcript-observed tokens; null when the usage scanner has no coverage. */
  totalObservedTokens: number | null
  unattributedTokens: number | null
  flags: AgentEffortFlag[]
}

export interface AgentEffortData {
  window: AgentEffortWindow
  /** ISO time of the last usage scan; observed columns are only as fresh as this. */
  scannedAt: string | null
  agents: AgentEffortRow[]
}
