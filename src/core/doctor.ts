/**
 * Bakin Doctor — orchestration only.
 *
 * Cron + cache + audit + notify. Every check is plugin-registered via
 * ctx.registerHealthCheck and contributed through runPluginHealthChecks.
 * Deep reference: .claude/knowledge/doctor-and-health-checks.md.
 *
 * Auto-fix policy is per-check: each plugin reads getSettings().doctor.autoFixSkill
 * inline. Unsafe issues (warn / error with autoFixable=false) are escalated
 * to the runtime main agent so they show up in conversation.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { getAppServices } from './app-services'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { isOnboarded } from './onboarding/state'
import { listHealthChecks } from './health-check-registry'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null
let lastResults: HealthCheckResult[] | null = null
let lastResultTime: number = 0

// Track what we've already notified about to avoid spamming the main agent
const notifiedIssues = new Set<string>()

/**
 * Run every plugin-registered health check in parallel. Per-check try/catch
 * isolates failures — a single bad handler yields one synthetic error result
 * and never crashes the doctor sweep. Exported separately from runDiagnostics
 * so the isolation behavior can be tested without mocking every plugin's
 * dependency tree.
 */
export async function runPluginHealthChecks(): Promise<HealthCheckResult[]> {
  const defs = listHealthChecks()
  const arrays = await Promise.all(
    defs.map(async (def) => {
      try {
        const rows = await def.run()
        if (!Array.isArray(rows)) {
          return [{
            check: def.id,
            status: 'error' as const,
            message: `Plugin health check returned non-array: ${typeof rows}`,
            autoFixable: false,
          }]
        }
        return rows
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return [{
          check: def.id,
          status: 'error' as const,
          message: `Plugin health check threw: ${message}`,
          autoFixable: false,
        }]
      }
    }),
  )
  return arrays.flat()
}

async function notifyUnfixableIssues(results: HealthCheckResult[]): Promise<void> {
  const issues = results.filter(r =>
    (r.status === 'warn' || r.status === 'error') && !r.autoFixable
  )

  if (issues.length === 0) return

  // Build a dedup key from the issues so we don't spam
  const issueKey = issues.map(i => `${i.check}:${i.status}`).sort().join('|')
  if (notifiedIssues.has(issueKey)) return
  notifiedIssues.add(issueKey)

  const lines = issues.map(i => {
    const icon = i.status === 'error' ? 'ERROR' : 'WARN'
    return `[${icon}] ${i.check}: ${i.message}`
  })

  const message = `Bakin Doctor found ${issues.length} issue(s) that need your attention:\n\n${lines.join('\n')}\n\nRun \`bakin doctor\` for full details.`

  try {
    const runtime = getAppServices().runtime
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    await runtime.messaging.send({ agentId: mainAgentId, content: message })
    log.info('Notified main agent of unfixable issues', { count: issues.length })
  } catch (err) {
    // Runtime might be the issue — can't notify about that
    log.warn('Could not notify main agent of doctor issues (runtime may be down)', err)
  }
}

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
  runDiagnostics(contentDir, projectRoot).catch(err => {
    log.error('Doctor startup check failed', err)
  })

  // Then run on interval
  doctorTimer = setInterval(() => {
    // Clear notification cache each cycle so recurring issues get re-reported
    // (but not within the same cycle)
    notifiedIssues.clear()
    runDiagnostics(contentDir, projectRoot).catch(err => {
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
