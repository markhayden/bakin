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
