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

/**
 * One line naming the incident's SANCTIONED fix. The margo forgery
 * (2026-09-21, #898): a delegated repair agent whose installer hung
 * hand-built the artifact and forged its receipt — because the brief never
 * told it what the sanctioned path was, nor that fabrication is worse than
 * failure. Every incident now names its published resolution explicitly.
 */
function describeSanctionedFix(incident: HealthIncident): string[] {
  const resolution = incident.resolution
  if (!resolution) {
    return ['  Sanctioned fix: none published — diagnose and report findings; do NOT improvise a fix.']
  }
  switch (resolution.type) {
    case 'repair':
      return [`  Sanctioned fix: one-click repair "${resolution.label}" — run the matching documented \`bakin\` command if the incident names one; otherwise report that this repair needs the operator's one-click in Health. Never re-implement it by hand.`]
    case 'instructions':
      return [
        `  Sanctioned fix: ${resolution.label}${resolution.command ? ` — run \`${resolution.command}\`` : ''}`,
        ...resolution.steps.slice(0, 4).map((step) => `    • ${step}`),
      ]
    case 'rerun':
      return [`  Sanctioned fix: re-run the check ("${resolution.label}") after addressing the cause.`]
    default:
      return ['  Sanctioned fix: see the incident in Health.']
  }
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
      ...describeSanctionedFix(incident),
    ]),
    '',
    'INTEGRITY RULES (non-negotiable):',
    '- Repair ONLY through the sanctioned fixes above, documented `bakin` commands, or published exec tools.',
    '- NEVER create, edit, or fabricate Bakin-internal state by hand: receipts, stores under ~/.bakin (media/, packages/, bin/, models/), lockfiles, .installedBy/.userEdited sidecars, the .onboarded marker, health acks, or databases. A hand-built artifact poisons health reporting and bricks the real repair.',
    '- If a sanctioned fix fails, hangs, or cannot be verified: STOP and block this task with exactly what you ran and what happened. A clearly reported failure is a SUCCESS outcome for this task; a fabricated fix is the worst possible outcome.',
    '- Verification means fresh Health checks passing on their own. Never edit anything to make a check pass without fixing the underlying cause.',
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
      // Effective disposition (#690): a sensitivity-demoted incident must not
      // spawn a paid repair task every surface called calm.
      : new Set(report.incidents.filter((incident) => incident.effectiveDisposition === 'action_required').map((incident) => incident.id))
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

/**
 * Manual verify (route/CLI): a fresh full sweep, then the SAME judgement the
 * cycle auto-close uses (plan review R4) — verified only when every
 * originating check evaluated healthy and no incident remains; a pass
 * completes the linked task and withdraws any pending approval.
 */
export async function verifyDoctorRepairRequest(
  options: Pick<DoctorDelegateOptions, 'contentDir' | 'projectRoot'> & { requestId: string },
): Promise<DoctorDelegateVerificationReport> {
  const request = getDoctorRepairRequest(options.contentDir, options.requestId)
  if (!request) throw new DoctorRepairRequestNotFoundError(options.requestId)
  const report = await runDiagnostics(options.contentDir, options.projectRoot)
  const { originatingCheckIds, recordVerification } = await import('./doctor-autoclose')
  const checkIds = originatingCheckIds(request, report)
  if (request.status === 'verified' || request.status === 'dismissed' || request.status === 'applying') {
    const open = new Set(report.incidents.map((incident) => incident.id))
    const remainingIncidentIds = request.incidentIds.filter((id) => open.has(id))
    return { request, remainingIncidentIds, verified: request.status === 'verified', reportId: report.id }
  }
  const { request: updated, verification } = await recordVerification(options.contentDir, request, report, checkIds)
  return { request: updated, remainingIncidentIds: verification.remainingIncidentIds, verified: verification.verified, reportId: report.id }
}
