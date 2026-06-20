/**
 * Workflow Gate Operations (human approval)
 *
 * Approve / reject / reopen surfaces for human gates. Depends one-way on the
 * engine (advanceWorkflow, propagateChildCompletion), step-context
 * (getCurrentStep), node-dispatch (dispatchReopenedStep), task-bridge, and
 * instance-store — nothing imports gates back.
 */
import type {
  ApprovalActor,
  WorkflowDefinition,
  WorkflowInstance,
  ParallelStep,
  GateStep,
} from '../types'
import { loadDefinition, findStep, getTopLevelIndex } from './parser'
import {
  notifyGateApproved,
  notifyGateRejected,
  notifyWorkflowComplete,
  notifyWorkflowReopened,
} from './notifications'
import { getContentDir } from './content-dir'
import { createLogger } from '@bakin/core/logger'
import { loadInstance, saveInstance, clearGateNotified } from './instance-store'
import { addTaskLogToStore, moveTaskInStore, completeTaskViaHooks } from './task-bridge'
import { dispatchReopenedStep } from './node-dispatch'
import { advanceWorkflow, propagateChildCompletion } from './engine'
import { getCurrentStep } from './step-context'

const log = createLogger('workflow-runtime')

export interface ApproveGateOptions {
  approver?: ApprovalActor
  contentDir?: string
}

export interface RejectGateOptions {
  approver?: ApprovalActor
  rewindTo?: string
  contentDir?: string
}

export interface ReopenFromStepOptions {
  actor?: ApprovalActor
  instanceId?: string
  stepId?: string
  reason: string
  contentDir?: string
}

export interface ReopenFromStepResult {
  success: boolean
  errors?: string[]
  taskId?: string
  instanceId?: string
  reopenedStepId?: string
}

/** Decision record returned by approveGate/rejectGate so callers
 * summary, audit) don't have to reload the instance. requestedAt may be
 * undefined for older instances created before #91 landed. */
export interface GateDecisionRecord {
  gateLabel: string
  approver?: ApprovalActor
  requestedAt?: string
  decidedAt: string
  durationMs?: number
  reason?: string
}

/**
 * Approve a gate step, advancing the workflow past it.
 */
export function approveGate(
  taskId: string,
  stepId: string,
  opts: ApproveGateOptions = {},
): { success: boolean; errors?: string[]; nextStep?: ReturnType<typeof getCurrentStep> | undefined; decision?: GateDecisionRecord } {
  const dir = opts.contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return { success: false, errors: ['Workflow instance not found'] }

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return { success: false, errors: ['Workflow definition not found'] }

  const step = findStep(def, stepId)
  if (!step || step.type !== 'gate') {
    return { success: false, errors: [`Step "${stepId}" is not a gate`] }
  }

  const stepState = instance.stepStates[stepId]
  if (stepState?.status !== 'pending_approval') {
    return { success: false, errors: [`Gate "${stepId}" is not pending approval (current: ${stepState?.status})`] }
  }

  // Mark gate as complete and record the decision
  const now = new Date().toISOString()
  const requestedAt = stepState.requestedAt
  stepState.status = 'complete'
  stepState.completedAt = now
  stepState.decidedAt = now
  if (opts.approver) stepState.approver = opts.approver

  instance.history.push({
    stepId,
    status: 'complete',
    completedAt: now,
    approver: opts.approver,
    requestedAt,
  })

  const decision: GateDecisionRecord = {
    gateLabel: step.label || stepId,
    approver: opts.approver,
    requestedAt,
    decidedAt: now,
    durationMs: requestedAt ? Date.parse(now) - Date.parse(requestedAt) : undefined,
  }

  instance.status = 'in_progress'
  advanceWorkflow(instance, def, dir)
  saveInstance(instance, dir)

  // Emit SSE event and clear notification tracking
  notifyGateApproved(instance, stepId, step.label || stepId, opts.approver)
  clearGateNotified(taskId, stepId, dir)

  // Log gate approval to the task so watchdog sees recent activity
  // and move it back to inProgress (from review) unless the workflow just completed
  addTaskLogToStore(taskId, 'workflow', `Gate "${step.label || stepId}" approved - advancing workflow.`)
    .then(() => {
      if ((instance.status as string) !== 'complete') {
        return moveTaskInStore(taskId, 'inProgress')
      }
    })
    .catch((err) => { log.warn('Failed to log gate approval', err) })

  if ((instance.status as string) === 'complete') {
    notifyWorkflowComplete(instance)

    // If this is a child workflow, propagate completion to parent
    if (instance.parentTaskId && instance.parentStepId) {
      propagateChildCompletion(instance, dir)
      return { success: true, nextStep: { status: 'complete' }, decision }
    }

    // Auto-move the task to done on the taskboard + emit audit event.
    completeTaskViaHooks(instance, 'review').catch((err) => {
      log.warn('Failed to complete task after gate approval', err)
    })
    return { success: true, nextStep: { status: 'complete' }, decision }
  }

  const nextStep = getCurrentStep(taskId, undefined, dir)
  return { success: true, nextStep: nextStep || undefined, decision }
}

/**
 * Reject a gate step, rewinding the workflow to a target step.
 * All steps after the rewind target are reset to 'pending'.
 */
export function rejectGate(
  taskId: string,
  stepId: string,
  reason: string,
  opts: RejectGateOptions = {},
): { success: boolean; errors?: string[]; rewoundTo?: string; decision?: GateDecisionRecord } {
  const dir = opts.contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return { success: false, errors: ['Workflow instance not found'] }

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return { success: false, errors: ['Workflow definition not found'] }

  const step = findStep(def, stepId)
  if (!step || step.type !== 'gate') {
    return { success: false, errors: [`Step "${stepId}" is not a gate`] }
  }

  const stepState = instance.stepStates[stepId]
  if (stepState?.status !== 'pending_approval') {
    return { success: false, errors: [`Gate "${stepId}" is not pending approval`] }
  }

  // Determine rewind target
  const gateStep = step as GateStep
  const targetId = opts.rewindTo || gateStep.on_reject?.goto
  if (!targetId) {
    return { success: false, errors: ['No rewind target specified and gate has no on_reject.goto'] }
  }

  const targetStep = findStep(def, targetId)
  if (!targetStep) {
    return { success: false, errors: [`Rewind target step not found: ${targetId}`] }
  }

  // Record rejection in history (durable — survives the rewind reset that
  // wipes the gate's stepState back to 'pending' for re-presentation).
  const now = new Date().toISOString()
  const requestedAt = stepState.requestedAt
  instance.history.push({
    stepId,
    status: 'rejected',
    completedAt: now,
    rejectionReason: reason,
    approver: opts.approver,
    requestedAt,
  })

  const decision: GateDecisionRecord = {
    gateLabel: gateStep.label || stepId,
    approver: opts.approver,
    requestedAt,
    decidedAt: now,
    durationMs: requestedAt ? Date.parse(now) - Date.parse(requestedAt) : undefined,
    reason,
  }

  // Mark gate as rejected pre-reset (the rewind loop below will overwrite,
  // but the history above is the durable record).
  stepState.status = 'rejected'
  stepState.decidedAt = now
  if (opts.approver) stepState.approver = opts.approver

  // Capture previous output from the rewind target before resetting
  const targetPreviousOutput = instance.stepStates[targetId]?.output

  // Reset all steps from target onward to pending, except the target itself
  const targetTopIdx = getTopLevelIndex(def, targetId)
  const gateTopIdx = getTopLevelIndex(def, stepId)

  for (let i = targetTopIdx; i <= gateTopIdx; i++) {
    const s = def.steps[i]
    instance.stepStates[s.id] = { status: 'pending' }
    if (s.type === 'parallel') {
      for (const child of (s as ParallelStep).steps) {
        instance.stepStates[child.id] = { status: 'pending' }
      }
    }
  }

  // Set the target step to in_progress with rejection context + previous output
  instance.currentStepId = targetId
  instance.status = 'in_progress'

  if (targetStep.type === 'parallel') {
    instance.stepStates[targetId] = { status: 'in_progress', startedAt: now }
    for (const child of (targetStep as ParallelStep).steps) {
      instance.stepStates[child.id] = { status: 'in_progress', startedAt: now }
    }
  } else {
    instance.stepStates[targetId] = {
      status: 'in_progress',
      startedAt: now,
      rejectionReason: gateStep.on_reject?.note_to_agent ? reason : undefined,
      previousOutput: targetPreviousOutput,
    }
  }

  saveInstance(instance, dir)

  // Emit SSE event and clear notification tracking
  notifyGateRejected(instance, stepId, step.label || stepId, reason, opts.approver)
  clearGateNotified(taskId, stepId, dir)

  // Log gate rejection and move task back to inProgress (from review)
  addTaskLogToStore(taskId, 'workflow', `Gate "${step.label || stepId}" rejected: ${reason}`)
    .then(() => moveTaskInStore(taskId, 'inProgress'))
    .catch((err) => { log.warn('Failed to log gate rejection', err) })

  return { success: true, rewoundTo: targetId, decision }
}

function resolveReopenStep(def: WorkflowDefinition, requestedStepId: string): { stepId: string } | { errors: string[] } {
  const requestedStep = findStep(def, requestedStepId)
  if (!requestedStep) return { errors: [`Step not found: ${requestedStepId}`] }
  if (requestedStep.type !== 'gate') return { stepId: requestedStepId }

  const gateStep = requestedStep as GateStep
  if (gateStep.on_reject?.goto) {
    const targetStep = findStep(def, gateStep.on_reject.goto)
    if (!targetStep) return { errors: [`Gate reopen target step not found: ${gateStep.on_reject.goto}`] }
    return { stepId: gateStep.on_reject.goto }
  }

  const gateTopIdx = getTopLevelIndex(def, requestedStepId)
  for (let index = gateTopIdx - 1; index >= 0; index--) {
    const candidate = def.steps[index]
    if (candidate.type !== 'gate') return { stepId: candidate.id }
  }

  return { errors: [`Gate "${requestedStepId}" has no actionable previous step`] }
}

function resetWorkflowFromStep(
  instance: WorkflowInstance,
  def: WorkflowDefinition,
  targetId: string,
  reason: string,
  now: string,
): { success: true; reopenedStepId: string } | { success: false; errors: string[] } {
  const targetStep = findStep(def, targetId)
  if (!targetStep) return { success: false, errors: [`Reopen target step not found: ${targetId}`] }
  if (targetStep.type === 'gate') return { success: false, errors: [`Reopen target "${targetId}" is a gate, not an actionable step`] }

  const targetTopIdx = getTopLevelIndex(def, targetId)
  if (targetTopIdx < 0) return { success: false, errors: [`Reopen target step not found: ${targetId}`] }

  const targetTopStep = def.steps[targetTopIdx]
  const currentOutput = instance.stepStates[targetId]?.output

  for (let index = targetTopIdx; index < def.steps.length; index++) {
    const step = def.steps[index]
    instance.stepStates[step.id] = { status: 'pending' }
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        instance.stepStates[child.id] = { status: 'pending' }
      }
    }
  }

  instance.currentStepId = targetTopStep.id
  instance.status = 'in_progress'

  if (targetTopStep.type === 'parallel') {
    instance.stepStates[targetTopStep.id] = { status: 'in_progress', startedAt: now, rejectionReason: reason }
    for (const child of (targetTopStep as ParallelStep).steps) {
      instance.stepStates[child.id] = { status: 'in_progress', startedAt: now }
    }
  } else {
    instance.stepStates[targetTopStep.id] = {
      status: 'in_progress',
      startedAt: now,
      rejectionReason: reason,
      previousOutput: currentOutput,
    }
  }

  return { success: true, reopenedStepId: targetTopStep.id }
}

export function reopenFromStep(taskId: string, opts: ReopenFromStepOptions): ReopenFromStepResult {
  const dir = opts.contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return { success: false, errors: ['Workflow instance not found'] }
  if (opts.instanceId && instance.instanceId !== opts.instanceId) {
    return { success: false, errors: ['Workflow instance does not match task'] }
  }
  if (instance.status === 'cancelled') return { success: false, errors: ['Cancelled workflow instances cannot be reopened'] }

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return { success: false, errors: ['Workflow definition not found'] }

  const requestedStepId = opts.stepId || instance.currentStepId
  const resolved = resolveReopenStep(def, requestedStepId)
  if ('errors' in resolved) return { success: false, errors: resolved.errors }

  const now = new Date().toISOString()
  const reset = resetWorkflowFromStep(instance, def, resolved.stepId, opts.reason, now)
  if (!reset.success) return { success: false, errors: reset.errors }

  instance.history.push({
    stepId: reset.reopenedStepId,
    status: 'in_progress',
    completedAt: now,
    output: {
      reopened: true,
      reason: opts.reason,
      actor: opts.actor,
      requestedStepId,
    },
  })
  saveInstance(instance, dir)
  dispatchReopenedStep(instance, def, reset.reopenedStepId, dir)
  notifyWorkflowReopened(instance, reset.reopenedStepId, opts.reason, opts.actor)

  addTaskLogToStore(taskId, 'workflow', `Workflow reopened at "${reset.reopenedStepId}": ${opts.reason}`)
    .then(() => moveTaskInStore(taskId, 'inProgress'))
    .catch((err) => { log.warn('Failed to log workflow reopen', err) })

  return {
    success: true,
    taskId: instance.taskId,
    instanceId: instance.instanceId,
    reopenedStepId: reset.reopenedStepId,
  }
}
