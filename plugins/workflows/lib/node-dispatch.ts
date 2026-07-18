/**
 * Workflow Node Dispatch
 *
 * System/plugin node execution: create-task nodes, plugin-owned node kinds
 * (via the hook registry), and re-dispatch of reopened steps. The single
 * back-edge into the engine — dispatchCreateTaskNode completing its node — is
 * a dynamic import('./engine') to keep the static module graph a DAG.
 */
import type {
  WorkflowInstance,
  WorkflowStep,
  ParallelStep,
  AgentStep,
  WorkflowDefinition,
  CreateTaskStep,
} from '../types'
import { loadDefinition, findStep } from './parser'
import { notifyStepDispatched } from './notifications'
import { isPluginKind } from '@bakin/core/workflows/node-type-registry'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from '@bakin/core/logger'
import { loadInstance, saveInstance } from './instance-store'
import { findTaskFromStore, addTaskLogToStore } from './task-bridge'
import { resolveAgent, getStepOwner } from './step-context'

const log = createLogger('workflow-runtime')

function getCreateTaskNodeId(instance: WorkflowInstance, step: CreateTaskStep): string {
  return step.taskId || `${instance.taskId}--${step.id}`
}

export function failSystemNode(
  taskId: string,
  stepId: string,
  error: unknown,
  contentDir: string,
): void {
  const instance = loadInstance(taskId, contentDir)
  if (!instance) return
  const stepState = instance.stepStates[stepId]
  if (!stepState || stepState.status !== 'in_progress') return

  const message = error instanceof Error ? error.message : String(error)
  const now = new Date().toISOString()
  stepState.status = 'failed'
  stepState.completedAt = now
  stepState.output = { error: message }
  instance.status = 'failed'
  instance.history.push({ stepId, status: 'failed', completedAt: now, output: { error: message } })
  saveInstance(instance, contentDir)
  // If this instance is a map fan-out child, surface the failure on the
  // parent's join entry — otherwise the join blocks showing in_progress.
  // (Mirrors engine.markMapChildFailed, inlined here because engine imports
  // this module — importing back would manufacture a cycle.)
  if (instance.parentTaskId && instance.parentStepId) {
    const parent = loadInstance(instance.parentTaskId, contentDir)
    const entry = parent?.stepStates[instance.parentStepId]?.children
      ?.find((c) => c.childTaskId === instance.taskId)
    if (parent && entry && entry.status === 'in_progress') {
      entry.status = 'failed'
      saveInstance(parent, contentDir)
    }
  }
  addTaskLogToStore(taskId, 'workflow', `Workflow node "${stepId}" failed: ${message}`)
    .catch((err) => { log.warn('Failed to log workflow node failure', err) })
}

export function dispatchCreateTaskNode(
  instance: WorkflowInstance,
  step: CreateTaskStep,
  contentDir: string,
): void {
  void (async () => {
    const fresh = loadInstance(instance.taskId, contentDir)
    if (!fresh) return
    if (fresh.stepStates[step.id]?.status !== 'in_progress') return

    const childTaskId = getCreateTaskNodeId(fresh, step)
    let created = false
    if (!(await findTaskFromStore(childTaskId))) {
      const { createTaskWithEffects } = await import('../../../src/core/task-service')
      await createTaskWithEffects({
        id: childTaskId,
        title: step.title,
        column: step.column || 'todo',
        assignee: step.agent,
        description: step.description,
        workflowId: step.workflowId,
        skipWorkflowReason: step.skipWorkflowReason,
        createdBy: 'workflow',
        parentId: step.parentId ?? fresh.taskId,
        projectId: step.projectId,
        availableAt: step.availableAt,
        dueAt: step.dueAt,
        source: step.source,
        channel: 'system',
      })
      created = true
    }

    const { completeStep } = await import('./engine')
    const result = completeStep(fresh.taskId, step.id, { taskId: childTaskId, created }, undefined, contentDir)
    if (!result.success) {
      throw new Error(result.errors?.join('; ') || `Failed to complete createTask node "${step.id}"`)
    }
  })().catch((err) => {
    log.error(`Create-task node '${step.id}' failed`, err as Error, {
      workflowId: instance.workflowId,
      taskId: instance.taskId,
      stepId: step.id,
    })
    failSystemNode(instance.taskId, step.id, err, contentDir)
  })
}

/**
 * Payload passed to `workflows.executeNode.{kind}` hook handlers. The plugin
 * that owns the kind is responsible for driving the step to completion
 * (eventually calling `completeStep` or handling errors itself).
 */
export interface PluginNodeDispatchPayload {
  taskId: string
  instanceId: string
  workflowId: string
  stepId: string
  /** The raw step definition — includes plugin-specific fields. */
  step: WorkflowStep
  /** Most recent completed step output (convenience — same as StepContext.priorStepOutput). */
  priorStepOutput?: Record<string, unknown>
  contentDir: string
}

/**
 * Dispatch a plugin-owned node kind via the hook registry. Fire-and-forget:
 * the owning plugin is expected to call `completeStep` when done (or handle
 * its own failure mode). Logs a warning if no handler is registered — the
 * workflow will stall at this step until the plugin activates or a human
 * force-completes it.
 */
export function dispatchPluginNode(
  instance: WorkflowInstance,
  step: WorkflowStep,
  contentDir: string,
): void {
  const hookName = `workflows.executeNode.${step.type}`
  const registry = getHookRegistry()
  if (!registry.has(hookName)) {
    log.warn(
      `No handler for plugin node kind '${step.type}' (hook: ${hookName}). ` +
      `Workflow ${instance.workflowId}/${instance.taskId} will stall at step '${step.id}' ` +
      `until the owning plugin activates.`,
    )
    return
  }

  // Collect prior step output for convenience
  let priorStepOutput: Record<string, unknown> | undefined
  const def = loadDefinition(instance.workflowId, contentDir)
  if (def) {
    const flat = def.steps.flatMap(s => s.type === 'parallel' ? (s as ParallelStep).steps : [s])
    const idx = flat.findIndex(s => s.id === step.id)
    for (let i = idx - 1; i >= 0; i--) {
      const priorState = instance.stepStates[flat[i].id]
      if (priorState?.output) {
        priorStepOutput = priorState.output
        break
      }
    }
  }

  const payload: PluginNodeDispatchPayload = {
    taskId: instance.taskId,
    instanceId: instance.instanceId,
    workflowId: instance.workflowId,
    stepId: step.id,
    step,
    priorStepOutput,
    contentDir,
  }

  // Fire-and-forget — log but don't surface errors from the handler back
  // into the runtime (the plugin owns its own error reporting).
  registry.invoke(hookName, payload).catch((err) => {
    log.error(`Plugin node handler for '${step.type}' threw`, err as Error, {
      workflowId: instance.workflowId,
      taskId: instance.taskId,
      stepId: step.id,
    })
  })
}

export function dispatchReopenedStep(instance: WorkflowInstance, def: WorkflowDefinition, reopenedStepId: string, contentDir: string): void {
  const step = findStep(def, reopenedStepId)
  if (!step) return

  if (step.type === 'parallel') {
    for (const child of (step as ParallelStep).steps) {
      if (child.type === 'agent') {
        notifyStepDispatched(instance, child.id, resolveAgent((child as AgentStep).agent, instance, child.id) || 'unknown', child.label)
      }
    }
  } else if (step.type === 'workflow') {
    const state = instance.stepStates[step.id]
    if (state?.childTaskId) {
      const child = loadInstance(state.childTaskId, contentDir)
      if (child && child.status !== 'cancelled') {
        child.status = 'in_progress'
        saveInstance(child, contentDir)
      }
    }
  } else if (isPluginKind(step.type)) {
    dispatchPluginNode(instance, step, contentDir)
  } else if (step.type === 'createTask') {
    dispatchCreateTaskNode(instance, step as CreateTaskStep, contentDir)
  } else if (step.type === 'agent' || step.type === 'output') {
    notifyStepDispatched(instance, step.id, getStepOwner(step, instance) || 'unknown', step.label)
  }
}
