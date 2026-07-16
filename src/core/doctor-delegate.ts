import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { HealthIncident, HealthRepairTarget } from '../../packages/core/src/plugin-types'
import { getAppServices } from './app-services'
import { dispatchSingleTask } from './dispatch'
import { getHealthReport } from './doctor-report-cache'
import { runDiagnostics } from './doctor-execution'
import { planDoctorRepair } from './doctor-repair'
import {
  DoctorRepairRequestNotFoundError,
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  updateDoctorRepairRequest,
  type DoctorRepairRequest,
} from './doctor-repair-store'
import { createTaskWithEffects } from './task-service'

export interface DoctorDelegateOptions {
  contentDir: string
  projectRoot: string
  accepted: boolean
  target?: HealthRepairTarget
}

export interface DoctorDelegateReport {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: DoctorRepairRequest
  incidents: HealthIncident[]
}

export interface DoctorDelegateVerificationReport {
  request: DoctorRepairRequest
  remainingIncidentIds: string[]
  verified: boolean
  reportId: string
}

function summarize(incidents: readonly HealthIncident[]): string {
  return `${incidents.length} incident${incidents.length === 1 ? '' : 's'} need attention`
}

function buildRepairBrief(request: DoctorRepairRequest, incidents: readonly HealthIncident[]): string {
  return [
    `Health repair request: ${request.id}`,
    '',
    'Resolve these Bakin Health incidents. Use their stable IDs when recording progress.',
    '',
    ...incidents.flatMap((incident) => [
      `- ${incident.title} (${incident.id})`,
      `  Impact: ${incident.impact}`,
    ]),
    '',
    'When the root causes are addressed, run fresh Health checks and complete this task with a short summary.',
  ].join('\n')
}

export async function delegateDoctorRepair(options: DoctorDelegateOptions): Promise<DoctorDelegateReport> {
  const report = getHealthReport()
  const target = options.target ?? { type: 'all_actionable' as const, reportId: report.id }
  const plan = await planDoctorRepair({
    contentDir: options.contentDir,
    projectRoot: options.projectRoot,
    target: { ...target, reportId: report.id } as HealthRepairTarget,
  })
  const incidentIds = target.type === 'incidents'
    ? new Set(target.ids)
    : target.type === 'observations'
      ? new Set(report.incidents.filter((incident) => incident.observationIds.some((id) => target.ids.includes(id))).map((incident) => incident.id))
      : new Set(report.incidents.filter((incident) => incident.disposition === 'action_required').map((incident) => incident.id))
  const incidents = report.incidents.filter((incident) => incidentIds.has(incident.id))
  const observationIds = [...new Set(incidents.flatMap((incident) => incident.observationIds))]
  const request = createDoctorRepairRequest(options.contentDir, {
    plan,
    incidentIds: incidents.map((incident) => incident.id),
    observationIds,
  })

  if (incidents.length === 0) return { status: 'no_unresolved', request, incidents }
  if (!options.accepted) return { status: 'confirmation_required', request, incidents }

  const runtime = getAppServices().runtime
  const agentId = await getRuntimeMainAgentId(runtime)
  const task = await createTaskWithEffects({
    title: `Health repair: ${summarize(incidents)}`,
    column: 'todo',
    assignee: agentId,
    description: buildRepairBrief(request, incidents),
    createdBy: 'system',
    source: {
      pluginId: 'health',
      entityType: 'doctor-repair',
      entityId: request.id,
      purpose: 'delegated-repair',
    },
    channel: 'system',
  })

  updateDoctorRepairRequest(options.contentDir, request.id, (current) => ({
    ...current,
    status: 'sent',
    taskId: task.id,
    agentId,
    events: [...current.events, {
      ts: new Date().toISOString(),
      type: 'task-created',
      message: `Created linked repair task ${task.id}.`,
      data: { taskId: task.id, agentId },
    }],
  }))
  await dispatchSingleTask(task.id, options.contentDir, Number(process.env.PORT || 3737), 'kick')
  const sent = updateDoctorRepairRequest(options.contentDir, request.id, (current) => ({
    ...current,
    status: 'sent',
    events: [...current.events, {
      ts: new Date().toISOString(),
      type: 'dispatch-kicked',
      message: `Kicked immediate dispatch for linked repair task ${task.id}.`,
      data: { taskId: task.id, agentId },
    }],
  }))
  return { status: 'sent', request: sent, incidents }
}

export async function verifyDoctorRepairRequest(
  options: Pick<DoctorDelegateOptions, 'contentDir' | 'projectRoot'> & { requestId: string },
): Promise<DoctorDelegateVerificationReport> {
  const request = getDoctorRepairRequest(options.contentDir, options.requestId)
  if (!request) throw new DoctorRepairRequestNotFoundError(options.requestId)
  const report = await runDiagnostics(options.contentDir, options.projectRoot)
  const active = new Set(report.incidents.map((incident) => incident.id))
  const remainingIncidentIds = request.incidentIds.filter((id) => active.has(id))
  const verified = remainingIncidentIds.length === 0
  const updated = updateDoctorRepairRequest(options.contentDir, request.id, (current) => ({
    ...current,
    status: verified ? 'verified' : current.status,
    events: [...current.events, {
      ts: new Date().toISOString(),
      type: 'verified',
      message: verified
        ? 'Original Health incidents no longer reproduce.'
        : `${remainingIncidentIds.length} original Health incident(s) still reproduce.`,
      data: { remainingIncidentIds, reportId: report.id },
    }],
  }))
  return { request: updated, remainingIncidentIds, verified, reportId: report.id }
}
