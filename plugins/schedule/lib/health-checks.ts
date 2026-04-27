/**
 * Schedule-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C4) — detects OpenClaw cron
 * jobs that aren't tracked in the Bakin schedule sidecar (orphans).
 *
 * Registered in plugins/schedule/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks it up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'
import { getMainAgentId } from '../../../src/core/main-agent'
import { getOpenClawPath } from '../../../packages/core/src/openclaw-home'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

const log = createLogger('schedule:health')

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

// ─── Schedule sync: orphan OpenClaw cron jobs not in Bakin's sidecar ───────

/**
 * Detect orphaned OpenClaw cron jobs that aren't tracked in Bakin's
 * `schedule/sidecar.json`. Auto-adopts them when
 * settings.doctor.autoFixSkill is true — creates a minimal sidecar
 * entry flagged `requireTriage: true` and explicitly leaves agentId
 * unset (the user must triage rather than have a guessed assignment).
 */
export function checkScheduleSync(contentDir: string): HealthCheckResult[] {
  const checkName = 'schedule-sync'
  const autoFix = getSettings().doctor.autoFixSkill
  const results: HealthCheckResult[] = []

  // Resolve OpenClaw jobs path — configurable, absent on fresh installs
  let jobsPath: string
  try {
    const configPath = getOpenClawPath('config.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      jobsPath = config?.cron?.store ?? getOpenClawPath('cron', 'jobs.json')
    } else {
      jobsPath = getOpenClawPath('cron', 'jobs.json')
    }
  } catch {
    jobsPath = getOpenClawPath('cron', 'jobs.json')
  }

  if (!existsSync(jobsPath)) {
    // Fresh install or no cron jobs yet — nothing to sync
    return [ok(checkName, 'No OpenClaw cron jobs file found (fresh install)')]
  }

  let openclawJobs: Array<{ id: string; name: string; payload?: Record<string, unknown> }>
  try {
    const raw = JSON.parse(readFileSync(jobsPath, 'utf-8'))
    openclawJobs = raw?.jobs ?? []
  } catch (err) {
    return [warn(checkName, `Failed to read OpenClaw jobs: ${err}`)]
  }

  if (openclawJobs.length === 0) {
    return [ok(checkName, 'No OpenClaw cron jobs to sync')]
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

  const orphans: typeof openclawJobs = []
  for (const job of openclawJobs) {
    if (!sidecar.jobs[job.id]) {
      orphans.push(job)
    }
  }

  if (orphans.length === 0) {
    return [ok(checkName, `${openclawJobs.length} cron job(s), all tracked in Bakin sidecar`)]
  }

  for (const orphan of orphans) {
    if (autoFix) {
      // Auto-adopt: create minimal sidecar entry flagged for manual triage
      const now = new Date().toISOString()
      const entry = {
        jobId: orphan.id,
        isBakinJob: false,
        displayName: orphan.name,
        agentId: undefined, // Don't guess — flag for triage
        owner: getMainAgentId(),
        requireTriage: true,
        createdAt: now,
        updatedAt: now,
      }
      sidecar.jobs[orphan.id] = entry
      results.push(fixed(checkName, `Auto-adopted orphan cron job "${orphan.name}" (id: ${orphan.id})`))
      log.info('Auto-adopted orphan cron job', { jobId: orphan.id, name: orphan.name })
    } else {
      results.push(warn(checkName, `Orphan cron job "${orphan.name}" (id: ${orphan.id}) — not tracked in Bakin sidecar`, true))
    }
  }

  // Write updated sidecar if we adopted anything
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
