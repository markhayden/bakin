/**
 * Bakin Doctor — orchestration only.
 *
 * Cron + cache + audit + notify. Every check is plugin-registered via
 * ctx.registerHealthCheck and contributed through runPluginHealthChecks.
 * Deep reference: .claude/knowledge/doctor-and-health-checks.md.
 *
 * Diagnostics are report-only. Explicit repair flows are built on health-check
 * repair handlers; notify-agent is only an explicit report notification.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { isOnboarded } from './onboarding/state'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

import { runPluginHealthChecks } from './doctor-checks'
import { escalateCronErrors, notifyUnfixableIssues, clearNotifiedIssues } from './doctor-escalation'

// Re-exported for existing consumers; the implementation lives in the leaf
// module so doctor-repair can import it without a cycle.
export { runDetailedPluginHealthChecks, runPluginHealthChecks, type DetailedHealthCheckRun } from './doctor-checks'

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null
let lastResults: HealthCheckResult[] | null = null
let lastResultTime: number = 0

export async function runDiagnostics(
  contentDir: string,
  _projectRoot: string,
  options: { notifyAgent?: boolean } = {},
): Promise<HealthCheckResult[]> {
  void _projectRoot
  const settings = getSettings()

  // Gate: if the machine has never been through first-run onboarding and
  // the config says to enforce it, return a single actionable error and
  // skip all the normal checks. Keeps doctor quiet on a fresh machine
  // and points the user at `bakin onboard` instead of drowning them in
  // unrelated errors about missing personas, runtime down, etc.
  if (settings.doctor.requireOnboard && !isOnboarded()) {
    return [{
      check: 'onboarded',
      status: 'error',
      message: 'Bakin is not onboarded on this machine. Run `bakin onboard` to complete first-run setup.',
      autoFixable: false,
    }]
  }

  const results = await runPluginHealthChecks()

  const errors = results.filter(r => r.status === 'error').length
  const warnings = results.filter(r => r.status === 'warn').length
  const fixes = results.filter(r => r.status === 'fixed').length

  if (errors > 0 || warnings > 0) {
    log.warn('Doctor found issues', { errors, warnings, fixes })
  } else {
    log.info('Doctor: all checks passed', { fixes })
  }

  appendAudit(contentDir, 'doctor.run', 'system', {
    total: results.length,
    errors,
    warnings,
    fixes,
  })

  if (options.notifyAgent) {
    await notifyUnfixableIssues(results)
  }

  lastResults = results
  lastResultTime = Date.now()

  return results
}

/**
 * Return the most recent diagnostic results without re-running checks.
 * Returns null if diagnostics have never run.
 */
export function getLastResults(): { results: HealthCheckResult[]; timestamp: number } | null {
  if (!lastResults) return null
  return { results: lastResults, timestamp: lastResultTime }
}

// ─── Cron ─────────────────────────────────────────────────────────────────

export function start(contentDir: string, projectRoot: string): void {
  const settings = getSettings()

  // Run immediately on startup
  runDiagnostics(contentDir, projectRoot)
    .then(results => escalateCronErrors(results, contentDir, projectRoot))
    .catch(err => {
      log.error('Doctor startup check failed', err)
    })

  // Then run on interval
  doctorTimer = setInterval(() => {
    // Clear notification cache each cycle so recurring issues get re-reported
    // (but not within the same cycle)
    clearNotifiedIssues()
    runDiagnostics(contentDir, projectRoot)
      .then(results => escalateCronErrors(results, contentDir, projectRoot))
      .catch(err => {
        log.error('Doctor periodic check failed', err)
      })
  }, settings.doctor.intervalMs)

  log.info('Doctor started', { intervalMs: settings.doctor.intervalMs })
}

export function stop(): void {
  if (doctorTimer) {
    clearInterval(doctorTimer)
    doctorTimer = null
    log.info('Doctor stopped')
  }
}
