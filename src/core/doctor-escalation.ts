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
 *               already covers every current error check, and rate-limited
 *               by escalationCooldownMs so a persistent error never spawns
 *               a task per cycle.
 *  - 'notify' → messages the main agent (the --notify-agent path).
 *  - 'off'    → old behavior.
 *
 * Only the CRON escalates — runDiagnostics itself is untouched, so manual
 * `bakin doctor` runs never surprise-create tasks.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

const log = createLogger('doctor-escalation')

export async function escalateCronErrors(
  results: HealthCheckResult[],
  contentDir: string,
  projectRoot: string,
): Promise<void> {
  const { escalation, escalationCooldownMs } = getSettings().doctor
  if (escalation === 'off') return
  const errors = results.filter((row) => row.status === 'error')
  if (errors.length === 0) return
  // A not-onboarded machine has no main agent to escalate to — the
  // onboarding surfaces own this state.
  if (errors.some((row) => row.check === 'onboarded')) return

  try {
    if (escalation === 'notify') {
      const { notifyUnfixableIssues } = await import('./doctor')
      await notifyUnfixableIssues(results)
      return
    }

    // 'task': ONE open repair task per persisting error set.
    const errorChecks = [...new Set(errors.map((row) => row.check))]
    const { listDoctorRepairRequests } = await import('./doctor-repair-store')
    const { getTaskDetails } = await import('./task-service')
    for (const request of listDoctorRepairRequests(contentDir)) {
      const covered = new Set(request.unresolved.map((row) => row.check))
      if (!errorChecks.every((check) => covered.has(check))) continue
      if (request.taskId) {
        const details = await getTaskDetails(request.taskId).catch(() => null)
        if (details && details.column !== 'done') {
          log.info('escalation skipped — an open repair task already covers the current errors', {
            taskId: request.taskId,
            checks: errorChecks,
          })
          return
        }
      }
      if (Date.now() - Date.parse(request.createdAt) < escalationCooldownMs) {
        log.info('escalation skipped — same error set escalated inside the cooldown window', {
          requestId: request.id,
          checks: errorChecks,
        })
        return
      }
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
