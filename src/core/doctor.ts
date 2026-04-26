/**
 * Bakin Doctor — health checks, OpenClaw sync, and auto-repair.
 * Runs on startup and on a configurable cadence to keep systems aligned.
 *
 * Auto-fix policy:
 *   SAFE (auto-fix):   Creating new files, installing/updating skill, making dirs
 *   UNSAFE (notify):   Agent roster mismatches, gateway down, task DB issues,
 *                      anything requiring human judgment
 *
 * Unsafe issues are reported to the main agent via OpenClaw so they show up in conversation.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import * as openclaw from './openclaw-client'
import { isOnboarded } from './onboarding/state'
import { getMainAgentId } from './main-agent'
import { listHealthChecks } from '../../plugins/health/lib/health-check-registry'

/**
 * Run every plugin-registered health check in parallel. Per-check try/catch
 * isolates failures — a single bad handler yields one synthetic error result
 * and never crashes the doctor sweep. Exported separately from runDiagnostics
 * so the isolation behavior can be tested without mocking every builtin
 * check's dependency tree.
 */
export async function runPluginHealthChecks(): Promise<DiagnosticResult[]> {
  const defs = listHealthChecks()
  const arrays = await Promise.all(
    defs.map(async (def) => {
      try {
        return await def.run()
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

const log = createLogger('doctor')

let doctorTimer: NodeJS.Timeout | null = null
let lastDiagnosticResults: DiagnosticResult[] | null = null
let lastDiagnosticTime: number = 0

// Track what we've already notified about to avoid spamming the main agent
const notifiedIssues = new Set<string>()

export interface DiagnosticResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

async function notifyUnfixableIssues(results: DiagnosticResult[]): Promise<void> {
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
    await openclaw.sendMessage(getMainAgentId(), message)
    log.info('Notified main agent of unfixable issues', { count: issues.length })
  } catch (err) {
    // Gateway might be the issue — can't notify about that
    log.warn('Could not notify main agent of doctor issues (gateway may be down)', err)
  }
}

export async function runDiagnostics(
  contentDir: string,
  projectRoot: string
): Promise<DiagnosticResult[]> {
  const settings = getSettings()

  // Gate: if the machine has never been through first-run onboarding and
  // the config says to enforce it, return a single actionable error and
  // skip all the normal checks. Keeps doctor quiet on a fresh machine
  // and points the user at `bakin onboard` instead of drowning them in
  // unrelated errors about missing personas, gateway down, etc.
  if (settings.doctor.requireOnboard && !isOnboarded()) {
    return [{
      check: 'onboarded',
      status: 'error',
      message: 'Bakin is not onboarded on this machine. Run `bakin onboard` to complete first-run setup.',
      autoFixable: false,
    }]
  }

  const results: DiagnosticResult[] = []

  // Migrated checks (live in their owner plugins, picked up via the
  // plugin-check loop at the end of this function):
  //   workflows: workflow-skills / workflow-definitions / workflow-instances (#137)
  //   team: agent-roster / personas / agent-assets (#139 C1)
  //   tasks: taskboard / task-consistency / order-integrity (#139 C2)
  //   assets: assets (#139 C3)
  //   schedule: schedule-sync (#139 C4)
  //   memory: search-tables (#139 C5)
  //   health: content-dir / service / mcporter (#139 C6)
  //   health: gateway / antfly (#139 C7)
  //   health: orchestrator-rules / skill / plugin-assets (#139 C8)
  //   health: managed-blocks (#139 C9)

  // Plugin-contributed health checks (#137). Results appended to the same
  // list as builtins; the UI groups by status so ordering doesn't matter.
  results.push(...await runPluginHealthChecks())

  // Summarize
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

  // Notify the main agent about things we can't auto-fix
  await notifyUnfixableIssues(results)

  // Cache results for lightweight reads (e.g. health plugin polling)
  lastDiagnosticResults = results
  lastDiagnosticTime = Date.now()

  return results
}

/**
 * Return the most recent diagnostic results without re-running checks.
 * Returns null if diagnostics have never run.
 */
export function getLastResults(): { results: DiagnosticResult[]; timestamp: number } | null {
  if (!lastDiagnosticResults) return null
  return { results: lastDiagnosticResults, timestamp: lastDiagnosticTime }
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

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
