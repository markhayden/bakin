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
import { createAppServices, maybeGetAppServices } from '../app-services'
import { scanAgentSync, type SyncScanReport } from '../agent-packages/sync-scanner'
import { repairPackLocally, syncAllAgents } from '../agent-packages/sync'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
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

/**
 * The scanner talks to the runtime adapter. In the server process AppServices
 * already exist; the CLI's `bakin check/install agent-sync` path runs in its
 * own process and must create them first (same pattern as the credentials +
 * openclaw-integration components).
 */
async function ensureAppServices(): Promise<void> {
  if (maybeGetAppServices()) return
  await createAppServices()
}

async function check(): Promise<CheckResult> {
  let report: SyncScanReport
  try {
    await ensureAppServices()
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
  await ensureAppServices()
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

  // Standalone packs (skill/workflow/lesson) own projections too — a drifted
  // pack skill (e.g. a capability pack's global skill) is invisible to the
  // per-agent sync above. Repair each pack that carried findings — LOCALLY
  // (re-project from the installed source; this component never fetches),
  // and discriminate packs by lockfile KIND, never by key shape.
  const lock = readLockfile()
  const packIds = [...new Set(
    before.findings
      .map((f) => f.packageId)
      .filter((id): id is string => typeof id === 'string' && lock.packages[id] !== undefined && lock.packages[id].kind !== 'agent'),
  )]
  const failedPacks: Array<{ packId: string; error: string }> = []
  for (const packId of packIds) {
    try {
      await repairPackLocally(packId)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      failedPacks.push({ packId, error })
      log.warn('agent-sync repair failed for pack', { packId, error })
    }
  }

  const after = await scanAgentSync()
  const durationMs = Date.now() - start
  const remaining = after.findings.length

  // Honest failure: if NOTHING that needed repair succeeded, this is a
  // failed install — a success toast over untouched drift is worse than
  // no repair at all.
  const attempted = results.length + packIds.length
  const totalFailed = failed.length + failedPacks.length
  if (attempted > 0 && totalFailed === attempted) {
    const parts = [
      ...failed.map((f) => `${f.agentId} (${f.error})`),
      ...failedPacks.map((f) => `${f.packId} (${f.error})`),
    ]
    return {
      name: 'agent-sync',
      status: 'failed',
      message: `Repair failed for all ${attempted} target(s): ${parts.join('; ')}`,
      durationMs,
      error: [...failed, ...failedPacks],
    }
  }

  const failedNote = failed.length > 0 ? ` — ${failed.length} agent(s) failed: ${failed.map((f) => f.agentId).join(', ')}` : ''
  const failedPacksNote = failedPacks.length > 0
    ? ` — ${failedPacks.length} pack(s) failed: ${failedPacks.map((f) => `${f.packId} (${f.error})`).join('; ')}`
    : ''
  const syncedPacksNote = packIds.length - failedPacks.length > 0 ? ` and ${packIds.length - failedPacks.length} pack(s)` : ''
  const remainingNote = remaining > 0
    ? ` ${remaining} finding(s) remain — run \`bakin agents sync --check\` for details.`
    : ''
  return {
    name: 'agent-sync',
    status: 'installed',
    message: `Synced ${results.length - failed.length} agent(s)${syncedPacksNote} locally.${remainingNote}${failedNote}${failedPacksNote}`,
    durationMs,
  }
}

export const agentSyncComponent: OnboardingComponent = {
  name: 'agent-sync',
  check,
  install,
}
