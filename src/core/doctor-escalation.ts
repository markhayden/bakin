/**
 * Cron/explicit escalation over fresh canonical action-required incidents.
 * Task escalation is deduplicated by incident identity, but a stalled repair
 * task stops suppressing the same still-burning incidents after the configured
 * stale threshold. Manual diagnostics never create tasks through this module.
 */
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { HealthIncident, HealthReport } from '../../packages/core/src/plugin-types'
import { meterAgentTurn } from './agent-cost'
import { getAppServices } from './app-services'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('doctor-escalation')
const DEFAULT_ESCALATION_COOLDOWN_MS = 6 * 60 * 60_000
const DEFAULT_ESCALATION_STALE_AFTER_MS = 12 * 60 * 60_000
const MAX_NOTIFICATION_STATES = 1_000

type PendingNotificationState = { status: 'pending' }
type NotificationState =
  | PendingNotificationState
  | { status: 'sent'; at: number }

const notificationStates = new Map<string, NotificationState>()

export function clearNotifiedIssues(): void {
  notificationStates.clear()
}

export function freshActionRequiredIncidents(report: HealthReport): HealthIncident[] {
  return report.incidents.filter((incident) =>
    incident.disposition === 'action_required' && !incident.stale,
  )
}

function notificationCooldownMs(): number {
  const value = getSettings().doctor.escalationCooldownMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_ESCALATION_COOLDOWN_MS
}

function reserveNotifications(
  incidents: readonly HealthIncident[],
  now: number,
  cooldownMs: number,
): Array<{ incident: HealthIncident; state: PendingNotificationState }> {
  for (const [incidentId, state] of notificationStates) {
    if (state.status === 'sent' && now - state.at >= cooldownMs) {
      notificationStates.delete(incidentId)
    }
  }

  const reserved: Array<{ incident: HealthIncident; state: PendingNotificationState }> = []
  for (const incident of incidents) {
    if (notificationStates.has(incident.id)) continue
    const state = { status: 'pending' } as const
    notificationStates.set(incident.id, state)
    reserved.push({ incident, state })
  }
  return reserved
}

function boundNotificationStates(): void {
  if (notificationStates.size <= MAX_NOTIFICATION_STATES) return
  const oldestSent = [...notificationStates.entries()]
    .filter((entry): entry is [string, Extract<NotificationState, { status: 'sent' }>] => entry[1].status === 'sent')
    .sort((a, b) => a[1].at - b[1].at)
  for (const [incidentId] of oldestSent) {
    if (notificationStates.size <= MAX_NOTIFICATION_STATES) break
    notificationStates.delete(incidentId)
  }
}

export async function notifyActionRequiredIncidents(report: HealthReport): Promise<void> {
  const reserved = reserveNotifications(
    freshActionRequiredIncidents(report),
    Date.now(),
    notificationCooldownMs(),
  )
  if (reserved.length === 0) return
  const incidents = reserved.map(({ incident }) => incident)

  const lines = incidents.flatMap((incident) => [
    `[NEEDS ATTENTION] ${incident.title} (${incident.id})`,
    `Impact: ${incident.impact}`,
  ])
  const message = `Bakin Health found ${incidents.length} incident${incidents.length === 1 ? '' : 's'} that need attention:\n\n${lines.join('\n')}\n\nOpen Health or run \`bakin doctor\` for current evidence and resolution steps.`
  try {
    const runtime = getAppServices().runtime
    const agentId = await getRuntimeMainAgentId(runtime)
    const result = await runtime.messaging.send({ agentId, content: message, activityClass: 'system' })
    const sentAt = Date.now()
    for (const { incident, state } of reserved) {
      if (notificationStates.get(incident.id) === state) {
        notificationStates.set(incident.id, { status: 'sent', at: sentAt })
      }
    }
    boundNotificationStates()
    try {
      await meterAgentTurn({ agent: agentId, activityClass: 'system', result, name: 'doctor-notify' })
    } catch (error) {
      log.warn('Health incident notification was delivered but could not be metered', { error })
    }
    log.info('Notified main agent of Health incidents', { incidentIds: incidents.map((incident) => incident.id) })
  } catch (error) {
    for (const { incident, state } of reserved) {
      if (notificationStates.get(incident.id) === state) notificationStates.delete(incident.id)
    }
    log.error('Failed to notify main agent of Health incidents', error)
  }
}

function onboardingOnly(incidents: readonly HealthIncident[]): boolean {
  return incidents.length > 0 && incidents.every((incident) => incident.id === 'core:system:onboarding-required')
}

export async function escalateCronIncidents(
  report: HealthReport,
  contentDir: string,
  projectRoot: string,
): Promise<void> {
  const {
    escalation = 'off',
    escalationCooldownMs = DEFAULT_ESCALATION_COOLDOWN_MS,
    escalationStaleAfterMs = DEFAULT_ESCALATION_STALE_AFTER_MS,
  } = getSettings().doctor
  if (escalation === 'off') return
  const incidents = freshActionRequiredIncidents(report)
  if (incidents.length === 0 || onboardingOnly(incidents)) return

  try {
    if (escalation === 'notify') {
      await notifyActionRequiredIncidents(report)
      return
    }

    const incidentIds = incidents.map((incident) => incident.id).sort()
    const { listDoctorRepairRequests } = await import('./doctor-repair-store')
    const { getTaskDetails } = await import('./task-service')
    let staleCoveringTaskId: string | null = null
    for (const request of listDoctorRepairRequests(contentDir)) {
      const covered = new Set(request.incidentIds)
      if (!incidentIds.every((id) => covered.has(id))) continue
      const ageMs = Date.now() - Date.parse(request.createdAt)
      if (request.taskId) {
        const details = await getTaskDetails(request.taskId).catch(() => null)
        const column = details && 'column' in details ? details.column : null
        // Both done and archived are closed. A missing task is not an open
        // cover; cooldown below still prevents immediate replacement churn.
        const open = column !== null && column !== 'done' && column !== 'archived'
        if (open) {
          if (ageMs < escalationStaleAfterMs) {
            log.info('Health escalation skipped because a fresh open repair task covers the incidents', {
              taskId: request.taskId,
              incidentIds,
            })
            return
          }
          // A custom stale threshold may be shorter than the task cooldown.
          // Staleness expires the open-task cover, but never the global rate
          // limit that prevents one replacement task per doctor cycle.
          if (ageMs < escalationCooldownMs) {
            log.info('Health escalation skipped inside the incident cooldown window', {
              requestId: request.id,
              incidentIds,
            })
            return
          }
          // Keep scanning: a newer fresh covering request must still win.
          staleCoveringTaskId = request.taskId
          continue
        }
      }
      if (ageMs < escalationCooldownMs) {
        log.info('Health escalation skipped inside the incident cooldown window', {
          requestId: request.id,
          incidentIds,
        })
        return
      }
    }
    if (staleCoveringTaskId) {
      log.warn('Covering Health repair task is stale; re-escalating current incidents', {
        taskId: staleCoveringTaskId,
        staleAfterMs: escalationStaleAfterMs,
        incidentIds,
      })
    }

    const { delegateDoctorRepair } = await import('./doctor-delegate')
    await delegateDoctorRepair({
      contentDir,
      projectRoot,
      accepted: true,
      target: { type: 'incidents', reportId: report.id, ids: incidentIds as [string, ...string[]] },
    })
  } catch (error) {
    log.error('Health escalation failed', error, { mode: escalation, incidentIds: incidents.map((incident) => incident.id) })
  }
}

/** Removed-name bridge is intentionally absent: callers use incident semantics. */
