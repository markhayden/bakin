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
import { getSettings } from '../../../src/core/settings'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

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
 * `schedule/sidecar.json`. Auto-tracks them when
 * settings.doctor.autoFixSkill is true - creates a minimal sidecar
 * entry flagged `requireTriage: true` and explicitly leaves agentId
 * unset (the user must triage rather than have a guessed assignment).
 */
export async function checkScheduleSync(
  contentDir: string,
  cron: RuntimeCronReader,
  defaultOwner: string,
): Promise<HealthCheckResult[]> {
  const checkName = 'schedule-sync'
  const autoFix = getSettings().doctor.autoFixSkill
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
