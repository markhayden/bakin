import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { getAppServices } from './app-services'
import { planDoctorRepair, type DoctorRepairPlanReport } from './doctor-repair'
import {
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  updateDoctorRepairRequest,
  type DoctorRepairRequest,
} from './doctor-repair-store'
import { createTaskWithEffects } from './task-service'
import { dispatchSingleTask } from './dispatch'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

export interface DoctorDelegateOptions {
  contentDir: string
  projectRoot: string
  accepted: boolean
}

export interface DoctorDelegateReport {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: DoctorRepairRequest
  unresolved: HealthCheckResult[]
}

export interface DoctorDelegateVerificationReport {
  request: DoctorRepairRequest
  remaining: HealthCheckResult[]
  verified: boolean
}

function unresolvedRows(plan: DoctorRepairPlanReport): HealthCheckResult[] {
  const safeRepairChecks = new Set(
    plan.items
      .filter(item => item.safety === 'safe')
      .map(item => item.checkId),
  )
  return plan.diagnostics.filter(row => (
    (row.status === 'warn' || row.status === 'error')
    && !safeRepairChecks.has(row.check)
  ))
}

function summarizeUnresolved(rows: HealthCheckResult[]): string {
  if (rows.length === 0) return 'no unresolved doctor findings'
  const errors = rows.filter(row => row.status === 'error').length
  const warnings = rows.filter(row => row.status === 'warn').length
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
}

function buildRepairBrief(request: DoctorRepairRequest, unresolved: HealthCheckResult[]): string {
  const lines = [
    `Doctor repair request: ${request.id}`,
    '',
    'Resolve the following Bakin doctor findings. Use normal Bakin tools and update the linked task with progress.',
    '',
    ...unresolved.map(row => `- [${row.status.toUpperCase()}] ${row.check}: ${row.message}`),
    '',
    'When you believe the issue is fixed, run `bakin doctor --full` and complete this task with a short summary.',
  ]
  return lines.join('\n')
}

function rowSignature(row: HealthCheckResult): string {
  return `${row.check}:${row.status}:${row.message}`
}

export async function delegateDoctorRepair(options: DoctorDelegateOptions): Promise<DoctorDelegateReport> {
  const plan = await planDoctorRepair({
    contentDir: options.contentDir,
    projectRoot: options.projectRoot,
  })
  const unresolved = unresolvedRows(plan)
  const request = createDoctorRepairRequest(options.contentDir, { plan, unresolved })

  if (unresolved.length === 0) {
    return { status: 'no_unresolved', request, unresolved }
  }

  if (!options.accepted) {
    return { status: 'confirmation_required', request, unresolved }
  }

  const runtime = getAppServices().runtime
  const agentId = await getRuntimeMainAgentId(runtime)
  const task = await createTaskWithEffects({
    title: `Doctor repair: ${summarizeUnresolved(unresolved)}`,
    column: 'todo',
    assignee: agentId,
    description: buildRepairBrief(request, unresolved),
    createdBy: 'system',
    source: {
      pluginId: 'health',
      entityType: 'doctor-repair',
      entityId: request.id,
      purpose: 'delegated-repair',
    },
    channel: 'system',
  })

  const withTask = updateDoctorRepairRequest(options.contentDir, request.id, current => ({
    ...current,
    status: 'sent',
    taskId: task.id,
    agentId,
    events: [
      ...current.events,
      {
        ts: new Date().toISOString(),
        type: 'task-created',
        message: `Created linked repair task ${task.id}.`,
        data: { taskId: task.id, agentId },
      },
    ],
  }))

  const port = Number(process.env.PORT || 3737)
  await dispatchSingleTask(task.id, options.contentDir, port, 'kick')

  const sent = updateDoctorRepairRequest(options.contentDir, request.id, current => ({
    ...current,
    status: 'sent',
    events: [
      ...current.events,
      {
        ts: new Date().toISOString(),
        type: 'dispatch-kicked',
        message: `Kicked immediate dispatch for linked repair task ${task.id}.`,
        data: { taskId: task.id, agentId },
      },
    ],
  }))

  return { status: 'sent', request: sent ?? withTask, unresolved }
}

export async function verifyDoctorRepairRequest(
  options: Pick<DoctorDelegateOptions, 'contentDir' | 'projectRoot'> & { requestId: string },
): Promise<DoctorDelegateVerificationReport> {
  const request = getDoctorRepairRequest(options.contentDir, options.requestId)
  if (!request) throw new Error(`Doctor repair request not found: ${options.requestId}`)

  const original = new Set(request.unresolved.map(rowSignature))
  const plan = await planDoctorRepair({
    contentDir: options.contentDir,
    projectRoot: options.projectRoot,
  })
  const remaining = unresolvedRows(plan).filter(row => original.has(rowSignature(row)))
  const verified = remaining.length === 0

  const updated = updateDoctorRepairRequest(options.contentDir, request.id, current => ({
    ...current,
    status: verified ? 'verified' : current.status,
    events: [
      ...current.events,
      {
        ts: new Date().toISOString(),
        type: 'verified',
        message: verified
          ? 'Original doctor findings no longer reproduce.'
          : `${remaining.length} original doctor finding(s) still reproduce.`,
        data: { remaining: remaining.length },
      },
    ],
  }))

  return { request: updated, remaining, verified }
}
