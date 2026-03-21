/**
 * Workflow notification dispatcher.
 * Emits SSE events for UI updates and optionally sends chat notifications
 * (Discord first) when gates are reached or workflows complete.
 */
import type { EventBus } from '../../src/lib/plugin-types'
import type { StepContext, WorkflowInstance } from './types'

let eventBus: EventBus | null = null

export function setEventBus(bus: EventBus): void {
  eventBus = bus
}

/**
 * Notify that a gate step has been reached and awaits approval.
 */
export function notifyGateReached(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  priorOutput?: Record<string, unknown>
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_reached', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
    priorOutput,
  })
}

/**
 * Notify that a workflow step has been completed.
 */
export function notifyStepComplete(
  instance: WorkflowInstance,
  stepId: string,
  label: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.step_complete', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
  })
}

/**
 * Notify that a workflow has been completed.
 */
export function notifyWorkflowComplete(instance: WorkflowInstance): void {
  if (!eventBus) return

  eventBus.emit('workflow.complete', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
  })
}

/**
 * Notify that a workflow step has been dispatched to an agent.
 */
export function notifyStepDispatched(
  instance: WorkflowInstance,
  stepId: string,
  agent: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.step_dispatched', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    agent,
  })
}
