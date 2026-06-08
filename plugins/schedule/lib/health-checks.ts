/**
 * Schedule-plugin-owned doctor check.
 *
 * Detects runtime cron jobs that aren't tracked in the Bakin schedule
 * sidecar.
 *
 * Registered in plugins/schedule/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks it up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { createLogger } from '../../../src/core/logger'
import type { HealthCheckResult, HealthRepairHandler } from '../../../packages/core/src/plugin-types'

const log = createLogger('schedule:health')

type RuntimeCronReader = Pick<AgentRuntimeAdapter['cron'], 'list'>

// ─── Result constructors (inlined; matches workflows precedent) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function error(check: string, message: string): HealthCheckResult {
  return { check, status: 'error', message, autoFixable: false }
}
function fixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

// ─── Schedule sync: orphan runtime cron jobs not in Bakin's sidecar ────────

/**
 * Detect orphaned runtime cron jobs that aren't tracked in Bakin's
 * `schedule/sidecar.json`. The explicit repair handler creates a minimal sidecar
 * entry flagged `requireTriage: true` and explicitly leaves agentId
 * unset (the user must triage rather than have a guessed assignment).
 */
export async function checkScheduleSync(
  contentDir: string,
  cron: RuntimeCronReader,
  defaultOwner: string,
): Promise<HealthCheckResult[]> {
  return checkScheduleSyncInternal(contentDir, cron, defaultOwner, false)
}

async function checkScheduleSyncInternal(
  contentDir: string,
  cron: RuntimeCronReader,
  defaultOwner: string,
  autoFix: boolean,
): Promise<HealthCheckResult[]> {
  const checkName = 'schedule-sync'
  const results: HealthCheckResult[] = []

  let runtimeJobs: Array<{ id: string; name: string }>
  try {
    runtimeJobs = (await cron.list()).map(job => ({
      id: job.id,
      name: job.name || job.id,
    }))
  } catch (err) {
    return [warn(checkName, `Failed to read runtime cron jobs: ${err}`)]
  }

  if (runtimeJobs.length === 0) {
    return [ok(checkName, 'No runtime cron jobs to sync')]
  }

  // Read Bakin sidecar
  let sidecar: { version: number; jobs: Record<string, unknown> }
  try {
    const sidecarPath = join(contentDir, 'schedule', 'sidecar.json')
    if (existsSync(sidecarPath)) {
      sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    } else {
      sidecar = { version: 1, jobs: {} }
    }
  } catch {
    sidecar = { version: 1, jobs: {} }
  }

  const orphans: typeof runtimeJobs = []
  for (const job of runtimeJobs) {
    if (!sidecar.jobs[job.id]) {
      orphans.push(job)
    }
  }

  if (orphans.length === 0) {
    return [ok(checkName, `${runtimeJobs.length} cron job(s), all tracked in Bakin sidecar`)]
  }

  for (const orphan of orphans) {
    if (autoFix) {
      // Auto-track: create minimal sidecar entry flagged for manual triage.
      // This is not Bakin adoption; it only records runtime visibility state.
      const now = new Date().toISOString()
      const entry = {
        jobId: orphan.id,
        isBakinJob: false,
        source: 'runtime',
        displayName: orphan.name,
        agentId: undefined, // Don't guess — flag for triage
        owner: defaultOwner,
        requireTriage: true,
        createdAt: now,
        updatedAt: now,
      }
      sidecar.jobs[orphan.id] = entry
      results.push(fixed(checkName, `Tracked orphan runtime cron job "${orphan.name}" (id: ${orphan.id})`))
      log.info('Tracked orphan cron job', { jobId: orphan.id, name: orphan.name })
    } else {
      results.push(warn(checkName, `Orphan runtime cron job "${orphan.name}" (id: ${orphan.id}) - not tracked in Bakin sidecar`, true))
    }
  }

  // Write updated sidecar if we tracked anything
  if (autoFix && results.some(r => r.status === 'fixed')) {
    try {
      const sidecarPath = join(contentDir, 'schedule', 'sidecar.json')
      const dir = dirname(sidecarPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8')
    } catch (err) {
      results.push(error(checkName, `Failed to write updated sidecar: ${err}`))
    }
  }

  return results
}

// ─── Cutover: Bakin schedules still backed by an OpenClaw cron job ─────────

/**
 * Detect Bakin schedules that still have a backing OpenClaw cron job. After
 * cutover a Bakin schedule fires from the store and must have NO runtime cron —
 * a lingering one means the cutover didn't complete (e.g. OpenClaw was
 * unreachable at boot) and the job can rogue-fire. The repair completes the
 * migration. This is the end-user migration/repair command:
 *   bakin check schedule-cutover   /   bakin install schedule-cutover
 */
export async function checkScheduleCutover(
  cron: RuntimeCronReader,
  bakinJobIds: () => string[],
): Promise<HealthCheckResult[]> {
  const check = 'schedule-cutover'
  let runtimeIds: Set<string>
  try {
    runtimeIds = new Set((await cron.list()).map(job => job.id))
  } catch (err) {
    return [warn(check, `Failed to read runtime cron jobs: ${err}`)]
  }

  const lingering = bakinJobIds().filter(id => runtimeIds.has(id))
  if (lingering.length === 0) {
    return [ok(check, 'All Bakin schedules are cut over (no backing OpenClaw cron jobs)')]
  }
  return lingering.map(id =>
    warn(check, `Bakin schedule "${id}" still has an OpenClaw cron job and can rogue-fire — run the repair to complete cutover.`, true),
  )
}

export function scheduleCutoverRepair(
  runMigration: () => Promise<{ migrated: number; failed: number }>,
): HealthRepairHandler {
  const check = 'schedule-cutover'
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === check && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'schedule.complete-cutover',
        checkId: check,
        title: 'Complete cutover of Bakin schedules off OpenClaw cron',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'runtime',
          target: 'OpenClaw cron jobs',
          action: 'delete',
          description: 'Import the schedule expression into Bakin and remove the backing OpenClaw cron job.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const summary = await runMigration()
      return [{
        id: 'schedule.complete-cutover',
        checkId: check,
        status: summary.failed > 0 ? 'failed' : 'applied',
        message: `Migrated ${summary.migrated} schedule(s) off OpenClaw cron${summary.failed > 0 ? `, ${summary.failed} failed` : ''}`,
        changes: summary.migrated > 0
          ? [{ kind: 'runtime' as const, target: 'OpenClaw cron jobs', action: 'delete' as const, description: `Removed ${summary.migrated} backing OpenClaw cron job(s).` }]
          : [],
      }]
    },
  }
}

export function scheduleSyncRepair(
  contentDir: string,
  cron: RuntimeCronReader,
  resolveDefaultOwner: () => Promise<string>,
): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'schedule-sync' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'schedule.track-runtime-cron',
        checkId: 'schedule-sync',
        title: 'Track orphan runtime cron jobs',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'file',
          target: join(contentDir, 'schedule', 'sidecar.json'),
          action: 'update',
          description: 'Add orphan runtime cron jobs to the schedule sidecar for manual triage.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const defaultOwner = await resolveDefaultOwner()
      const rows = await checkScheduleSyncInternal(contentDir, cron, defaultOwner, true)
      const failures = rows.filter(row => row.status === 'error')
      return [{
        id: 'schedule.track-runtime-cron',
        checkId: 'schedule-sync',
        status: failures.length > 0 ? 'failed' : 'applied',
        message: rows.map(row => row.message).join('; '),
        changes: rows
          .filter(row => row.status === 'fixed')
          .map(row => ({
            kind: 'file' as const,
            target: join(contentDir, 'schedule', 'sidecar.json'),
            action: 'update' as const,
            description: row.message,
          })),
      }]
    },
  }
}
