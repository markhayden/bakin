/**
 * Runtime hub — shared response types for the three tabs. These mirror the
 * server payloads exactly (GET /api/runtime/capabilities, /api/runtime/
 * onboarding, /api/packages/capabilities, POST /api/runtime/switch).
 */
import type { CapabilitiesPayload } from '../../lib/runtime-report'

export interface CapabilityReport {
  adapter: string
  adapters: string[]
  runtime: { name: string; version: string }
  capabilities: CapabilitiesPayload
  toolAccess: { style: string; ok: boolean; issues: string[] }
  credentialStatus?: {
    llmProviders: string[]
    llmCredentials?: Array<{ provider: string; kind: 'api-key' | 'oauth' }>
    channels: string[]
  }
}

export interface OnboardingComponentStatus {
  name: string
  status: 'ok' | 'warn' | 'missing' | 'broken' | 'error' | string
  message: string
  remediation?: string
}

export interface CapabilityReadiness {
  capability: string
  packageId: string
  version: string
  name: string
  description?: string
  skills: Array<{ name: string; status: 'ok' | 'missing' }>
  bins: Array<{ name: string; status: 'ok' | 'missing' | 'unsupported-platform' }>
  npm: Array<{ name: string; status: 'ok' | 'missing' }>
  models: Array<{ name: string; bytes: number; status: 'ok' | 'missing' }>
  prereqs: Array<{ name: string; kind: 'binary' | 'app'; help: string; optional: boolean; status: 'ok' | 'missing' }>
  secrets: Array<{ name: string; required: boolean; secretSlot?: string; help?: string; status: 'env' | 'store' | 'missing' }>
  platformSupported: boolean
  ready: boolean
  missing: string[]
}

export interface SwitchResultPayload {
  ok: boolean
  from: string
  to: string
  error?: string
  restored?: boolean
  backupPath: string | null
  restartRequired: boolean
  dryRun?: boolean
  roster: {
    carried: Array<{ agentId: string; model?: string; mappedFrom?: string; subagentModel?: string }>
    existing: string[]
    unmappedModels: Array<{ agentId: string; sourceModel: string; field?: 'model' | 'subagentModel' }>
    preserved?: Array<{ agentId: string; sourceModel: string }>
    failed: Array<{ agentId: string; error: string }>
  } | null
  workspaces: {
    carried: Array<{ agentId: string; files: number; bytes: number }>
    skills: Array<{ agentId: string; carried: number; skippedPackageManaged: number }>
    skippedExisting: string[]
    failed: Array<{ agentId: string; path: string; error: string }>
  } | null
  cron: { adopted: string[]; skipped: string[]; failed: Array<{ jobId: string; error: string }> } | null
  cantCarry: Array<{ concern: string; detail: string; count?: number }> | null
  credentials: { llmProviders: string[] } | null
  sync: { drifted: boolean; findings: number; syncedAgents: number } | null
}
