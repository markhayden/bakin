/**
 * agent-sync onboarding component (layered-context spec, C7 — supersedes
 * the old agent-assets component).
 *
 * `check()`  — runs the local drift scanner: managed blocks vs expected
 *              composition (with per-layer attribution), skills/assets vs
 *              installed source, role-context freshness, migration state.
 * `install()` — local repair: syncs every agent WITHOUT network fetches
 *              (recompose blocks + re-project skills/assets). `.userEdited`
 *              targets stay skipped; pre-migration packages are reported,
 *              never migrated implicitly (run `bakin agents sync` for the
 *              confirmed migration prompt).
 *
 * CLI surface: `bakin check agent-sync` / `bakin install agent-sync`.
 * The team plugin's `team.agent-sync` doctor check wraps the same scanner
 * so the two views never disagree.
 */
import { createLogger } from '../logger'
import { scanAgentSync, type SyncScanReport } from '../agent-packages/sync-scanner'
import { syncAllAgents } from '../agent-packages/sync'
import { refreshRoleContextBlocks } from '../team-context'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:agent-sync')

function summarize(report: SyncScanReport): { errors: number; warns: number; parts: string[] } {
  const byType = new Map<string, number>()
  for (const f of report.findings) {
    byType.set(f.type, (byType.get(f.type) ?? 0) + 1)
  }
  const parts = [...byType.entries()].map(([type, n]) => `${n} ${type}`)
  return {
    errors: report.findings.filter((f) => f.severity === 'error').length,
    warns: report.findings.filter((f) => f.severity === 'warn').length,
    parts,
  }
}

async function check(): Promise<CheckResult> {
  let report: SyncScanReport
  try {
    report = await scanAgentSync()
  } catch (err) {
    return {
      name: 'agent-sync',
      status: 'error',
      message: `Failed to scan agent sync state: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (report.findings.length === 0) {
    return {
      name: 'agent-sync',
      status: 'ok',
      message: `${report.agentsScanned} agent(s) in sync — ${report.blocksOk} managed block(s), ${report.projectionsOk} projection(s) verified`,
      details: { agentsScanned: report.agentsScanned, blocksOk: report.blocksOk, projectionsOk: report.projectionsOk },
    }
  }

  const { errors, parts } = summarize(report)
  const remediation = report.migrationNeeded
    ? 'Run `bakin agents sync` (prompts for the one-time block migration).'
    : 'Run `bakin install agent-sync` for local repair, or `bakin agents sync` to also pull upstream updates.'

  return {
    name: 'agent-sync',
    status: errors > 0 ? 'error' : 'warn',
    message: `${report.findings.length} agent-sync finding(s): ${parts.join(', ')}`,
    remediation,
    details: report as unknown as Record<string, unknown>,
  }
}

async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  const before = await scanAgentSync()

  if (before.findings.length === 0) {
    return {
      name: 'agent-sync',
      status: 'noop',
      message: 'All agents already in sync',
      durationMs: Date.now() - start,
    }
  }

  refreshRoleContextBlocks()
  const results = await syncAllAgents({ fetch: false, trigger: 'system' })
  const failed = results.filter((r) => r.error)
  for (const f of failed) {
    log.warn('agent-sync repair failed for agent', { agentId: f.agentId, error: f.error })
  }

  const after = await scanAgentSync()
  const durationMs = Date.now() - start
  const remaining = after.findings.length

  if (failed.length > 0 && failed.length === results.length) {
    return {
      name: 'agent-sync',
      status: 'failed',
      message: `Repair failed for all ${failed.length} agent(s): ${failed.map((f) => `${f.agentId} (${f.error})`).join('; ')}`,
      durationMs,
      error: failed,
    }
  }

  const failedNote = failed.length > 0 ? ` — ${failed.length} agent(s) failed: ${failed.map((f) => f.agentId).join(', ')}` : ''
  const remainingNote = remaining > 0
    ? ` ${remaining} finding(s) remain (user-edited locks and migration require explicit action).`
    : ''
  return {
    name: 'agent-sync',
    status: 'installed',
    message: `Synced ${results.length - failed.length} agent(s) locally.${remainingNote}${failedNote}`,
    durationMs,
  }
}

export const agentSyncComponent: OnboardingComponent = {
  name: 'agent-sync',
  check,
  install,
}
