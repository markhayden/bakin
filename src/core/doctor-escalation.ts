/** Cron/explicit escalation over fresh canonical action-required incidents. */
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { HealthIncident, HealthReport } from '../../packages/core/src/plugin-types'
import { meterAgentTurn } from './agent-cost'
import { getAppServices } from './app-services'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('doctor-escalation')
const notifiedIncidentIds = new Set<string>()

export function clearNotifiedIssues(): void {
  notifiedIncidentIds.clear()
}

export function freshActionRequiredIncidents(report: HealthReport): HealthIncident[] {
  return report.incidents.filter((incident) =>
    incident.disposition === 'action_required' && !incident.stale,
  )
}

export async function notifyActionRequiredIncidents(report: HealthReport): Promise<void> {
  const incidents = freshActionRequiredIncidents(report)
    .filter((incident) => !notifiedIncidentIds.has(incident.id))
  if (incidents.length === 0) return
  for (const incident of incidents) notifiedIncidentIds.add(incident.id)

  const lines = incidents.flatMap((incident) => [
    `[NEEDS ATTENTION] ${incident.title} (${incident.id})`,
    `Impact: ${incident.impact}`,
  ])
  const message = `Bakin Health found ${incidents.length} incident${incidents.length === 1 ? '' : 's'} that need attention:\n\n${lines.join('\n')}\n\nOpen Health or run \`bakin doctor\` for current evidence and resolution steps.`
  try {
    const runtime = getAppServices().runtime
    const agentId = await getRuntimeMainAgentId(runtime)
    const result = await runtime.messaging.send({ agentId, content: message, activityClass: 'system' })
    await meterAgentTurn({ agent: agentId, activityClass: 'system', result, name: 'doctor-notify' })
    log.info('Notified main agent of Health incidents', { incidentIds: incidents.map((incident) => incident.id) })
  } catch (error) {
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
  const { escalation = 'off', escalationCooldownMs = 6 * 60 * 60_000 } = getSettings().doctor
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
    for (const request of listDoctorRepairRequests(contentDir)) {
      const covered = new Set(request.incidentIds)
      if (!incidentIds.every((id) => covered.has(id))) continue
      if (request.taskId) {
        const details = await getTaskDetails(request.taskId).catch(() => null)
        const column = details && 'column' in details ? details.column : null
        if (column && column !== 'done' && column !== 'archived') return
      }
      if (Date.now() - Date.parse(request.createdAt) < escalationCooldownMs) return
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
