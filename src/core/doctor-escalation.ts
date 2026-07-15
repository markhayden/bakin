/**
 * Periodic-doctor escalation — turns cron ERROR findings into action.
 *
 * Before this, the 30-min doctor cron surfaced findings ONLY on the
 * dashboard: notifications were opt-in per CLI run (`--notify-agent`), so
 * the 2026-07-12 search-dark incident burned for 17h with a red row nobody
 * was looking at. Per settings.doctor.escalation, a cron cycle whose
 * results contain errors now either:
 *
 *  - 'task'   → creates ONE delegated-repair task for the main agent (the
 *               existing `bakin doctor --delegate` flow: durable request,
 *               board-visible task, dispatch kick, budget-gated like any
 *               task). Deduplicated: skipped while an open repair task
 *               already covers every current error check (until that task
 *               is older than escalationStaleAfterMs — a stalled repair
 *               task must not mute a still-burning error forever), and
 *               rate-limited by escalationCooldownMs so a persistent error
 *               never spawns a task per cycle.
 *  - 'notify' → messages the main agent (the --notify-agent path).
 *  - 'off'    → old behavior.
 *
 * Only the CRON escalates — runDiagnostics itself is untouched, so manual
 * `bakin doctor` runs never surprise-create tasks.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { getAppServices } from './app-services'
import { meterAgentTurn } from './agent-cost'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

const log = createLogger('doctor-escalation')

// Track what we've already notified about to avoid spamming the main agent.
// The doctor cron clears this each cycle so recurring issues re-report.
const notifiedIssues = new Set<string>()

export function clearNotifiedIssues(): void {
  notifiedIssues.clear()
}

export async function notifyUnfixableIssues(results: HealthCheckResult[]): Promise<void> {
  // Errors ALWAYS qualify — an autoFixable error is still an incident the
  // user must hear about (the 17h search-dark burn stayed silent partly
  // because fixable errors were filtered here); only fixable WARNS stay
  // quiet to bound noise.
  const issues = results.filter(r =>
    r.status === 'error' || (r.status === 'warn' && !r.autoFixable)
  )

  if (issues.length === 0) return

  // Build a dedup key from the issues so we don't spam
  const issueKey = issues.map(i => `${i.check}:${i.status}`).sort().join('|')
  if (notifiedIssues.has(issueKey)) return
  notifiedIssues.add(issueKey)

  const lines = issues.map(i => {
    const icon = i.status === 'error' ? 'ERROR' : 'WARN'
    const hint = i.autoFixable ? ' (repair available: `bakin doctor --fix`)' : ''
    return `[${icon}] ${i.check}: ${i.message}${hint}`
  })

  const message = `Bakin Doctor found ${issues.length} issue(s) that need your attention:\n\n${lines.join('\n')}\n\nRun \`bakin doctor\` for full details.`

  try {
    const runtime = getAppServices().runtime
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    const result = await runtime.messaging.send({ agentId: mainAgentId, content: message })
    await meterAgentTurn({ agent: mainAgentId, result, name: 'doctor-notify' })
    log.info('Notified main agent of unfixable issues', { count: issues.length })
  } catch (err) {
    log.error('Failed to notify main agent of doctor issues', err instanceof Error ? err : undefined)
  }
}

export async function escalateCronErrors(
  results: HealthCheckResult[],
  contentDir: string,
  projectRoot: string,
): Promise<void> {
  const { escalation, escalationCooldownMs, escalationStaleAfterMs } = getSettings().doctor
  if (escalation === 'off') return
  const errors = results.filter((row) => row.status === 'error')
  if (errors.length === 0) return
  // A not-onboarded machine has no main agent to escalate to — the
  // onboarding surfaces own this state.
  if (errors.some((row) => row.check === 'onboarded')) return

  try {
    if (escalation === 'notify') {
      await notifyUnfixableIssues(results)
      return
    }

    // 'task': ONE open repair task per persisting error set. An open
    // covering task suppresses re-escalation only while it is FRESH —
    // the 2026-07-14 wedge hid behind one stalled repair task for 34h
    // because this suppression had no expiry.
    const errorChecks = [...new Set(errors.map((row) => row.check))]
    const { listDoctorRepairRequests } = await import('./doctor-repair-store')
    const { getTaskDetails } = await import('./task-service')
    let staleCoveringTaskId: string | null = null
    for (const request of listDoctorRepairRequests(contentDir)) {
      const covered = new Set(request.unresolved.map((row) => row.check))
      if (!errorChecks.every((check) => covered.has(check))) continue
      const ageMs = Date.now() - Date.parse(request.createdAt)
      if (request.taskId) {
        const details = await getTaskDetails(request.taskId).catch(() => null)
        // 'done' AND 'archived' are closed — the 2026-07-14 incident's three
        // covering tasks were all ARCHIVED, and `!== 'done'` read each one
        // as an open cover, muting escalation indefinitely.
        const open = details !== null && details.column !== 'done' && details.column !== 'archived'
        if (open) {
          if (ageMs < escalationStaleAfterMs) {
            log.info('escalation skipped — an open repair task already covers the current errors', {
              taskId: request.taskId,
              checks: errorChecks,
            })
            return
          }
          // Stale open cover: the errors outlived the task meant to fix
          // them. Keep scanning — a fresher covering request still wins.
          staleCoveringTaskId = request.taskId
          continue
        }
      }
      if (ageMs < escalationCooldownMs) {
        log.info('escalation skipped — same error set escalated inside the cooldown window', {
          requestId: request.id,
          checks: errorChecks,
        })
        return
      }
    }
    if (staleCoveringTaskId) {
      log.warn('covering repair task is stale — re-escalating despite it being open', {
        taskId: staleCoveringTaskId,
        staleAfterMs: escalationStaleAfterMs,
        checks: errorChecks,
      })
    }

    const { delegateDoctorRepair } = await import('./doctor-delegate')
    const report = await delegateDoctorRepair({ contentDir, projectRoot, accepted: true, rows: errors })
    log.info('cron errors escalated as a delegated repair task', {
      status: report.status,
      taskId: report.request.taskId,
      checks: errorChecks,
    })
  } catch (err) {
    // Escalation is best-effort on top of the diagnostics — a failure here
    // must never take the doctor cycle down with it.
    log.error('doctor escalation failed', err instanceof Error ? err : undefined, {
      mode: escalation,
      errors: errors.length,
    })
  }
}
