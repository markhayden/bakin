/**
 * Workflow Engine (mutation core)
 *
 * The mutually-recursive mutation core, kept together deliberately:
 * createInstance ↔ advanceWorkflow ↔ propagateChildCompletion ↔ completeStep
 * call each other recursively (nested-workflow spawn, parallel join, child
 * propagation), so splitting them would manufacture import cycles.
 */
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StepState,
  MapChildEntry,
  ParallelStep,
  AgentStep,
  OutputStep,
  NestedWorkflowStep,
  MapWorkflowStep,
  CreateTaskStep,
} from '../types'
import { loadDefinition, validateWorkflowId, flattenSteps, findStep, getTopLevelIndex } from './parser'
import { loadSkill } from './skill-loader'
import { validateStepOutput, detectRejectionRepeat } from './schema-validator'
import {
  notifyWorkflowComplete,
  notifyStepDispatched,
  notifyStepComplete,
  notifyGateReached,
  sendGateApprovalRequest,
  getGateNotificationSettings,
} from './notifications'
import { getContentDir } from './content-dir'
import { isPluginKind } from '@bakin/core/workflows/node-type-registry'
import { createLogger } from '@bakin/core/logger'
import { loadInstance, saveInstance, generateId, listInstances } from './instance-store'
import {
  createBoardTaskForChild,
  completeTaskViaHooks,
  moveWorkflowTaskToReview,
  addTaskLogToStore,
  moveTaskInStore,
} from './task-bridge'
import { dispatchPluginNode, dispatchCreateTaskNode } from './node-dispatch'
import { resolveAgent, getCurrentStep } from './step-context'

const log = createLogger('workflow-runtime')

/** Fan-out width guardrail when a map step declares no max_children. */
const DEFAULT_MAX_CHILDREN = 32

// ─── Instance Creation ──────────────────────────────────────────────────────

/**
 * Create a new workflow instance for a task.
 * Initializes all step states to 'pending' and sets the first step to 'in_progress'.
 */
export function createInstance(
  taskId: string,
  workflowId: string,
  contentDir?: string,
  /** Snapshot the task assignee at workflow start for $assigned resolution */
  assignee?: string,
  /** Context from parent workflow — prior step output at spawn time */
  parentContext?: Record<string, unknown>,
  /** Snapshot of available runtime agents at workflow start for preferred selectors */
  availableAgents?: Iterable<string>,
): WorkflowInstance {
  const dir = contentDir || getContentDir()
  const workflowIdError = validateWorkflowId(workflowId)
  if (workflowIdError) throw new Error(workflowIdError)
  const def = loadDefinition(workflowId, dir)
  if (!def) throw new Error(`Workflow definition not found: ${workflowId}`)
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    throw new Error(`Workflow "${workflowId}" must have at least one step`)
  }

  const now = new Date().toISOString()
  const stepStates: Record<string, StepState> = {}
  const allSteps = flattenSteps(def.steps)

  for (const { id } of allSteps) {
    stepStates[id] = { status: 'pending' }
  }

  // Determine first step
  const firstStep = def.steps[0]
  let firstStepId: string

  if (firstStep.type === 'parallel') {
    // For parallel first step, mark all children as in_progress
    firstStepId = firstStep.id
    stepStates[firstStep.id] = { status: 'in_progress', startedAt: now }
    for (const child of (firstStep as ParallelStep).steps) {
      stepStates[child.id] = { status: 'in_progress', startedAt: now }
    }
  } else {
    firstStepId = firstStep.id
    stepStates[firstStepId] = { status: 'in_progress', startedAt: now }
  }

  const instance: WorkflowInstance = {
    instanceId: generateId(),
    workflowId,
    taskId,
    currentStepId: firstStepId,
    status: 'in_progress',
    stepStates,
    history: [],
    createdAt: now,
    updatedAt: now,
    resolvedAgent: assignee,
    availableAgents: availableAgents ? [...new Set(availableAgents)].sort() : undefined,
    parentContext,
  }

  saveInstance(instance, dir)

  // If the first step is a nested workflow, spawn the child instance now
  if (firstStep.type === 'workflow') {
    const nested = firstStep as NestedWorkflowStep
    const childTaskId = `${taskId}--${nested.id}`
    const childInstance = createInstance(childTaskId, nested.workflow_id, dir, assignee, parentContext, instance.availableAgents)
    childInstance.parentTaskId = taskId
    childInstance.parentStepId = nested.id
    saveInstance(childInstance, dir)
    instance.stepStates[firstStepId] = { status: 'in_progress', startedAt: now, childTaskId }
    saveInstance(instance, dir)

    // Create a board task so the child workflow's gates are visible in the UI
    const childDef = loadDefinition(nested.workflow_id, dir)
    createBoardTaskForChild(childTaskId, taskId, nested, childDef, childInstance)
  } else if (firstStep.type === 'map_workflow') {
    // Statically illegal (source must name an EARLIER step, so validation
    // rejects a first-step map) — but createInstance is reachable without
    // validation, so fail typed instead of dangling in_progress forever.
    fanOutMapStep(instance, firstStep as MapWorkflowStep, def, dir, now)
    saveInstance(instance, dir)
  } else if (isPluginKind(firstStep.type)) {
    // First step is a plugin-owned kind — fire its executeNode hook.
    dispatchPluginNode(instance, firstStep, dir)
  } else if (firstStep.type === 'createTask') {
    dispatchCreateTaskNode(instance, firstStep as CreateTaskStep, dir)
  }

  return instance
}

// ─── Map Fan-out ────────────────────────────────────────────────────────────

/**
 * Rebuild the parentContext a map child at `index` receives: the source
 * step's full output plus the item under item_key and its map coordinates.
 * Shared by fan-out and per-child retry (map-children.ts) so a re-created
 * child always sees exactly what the original spawn saw. Returns null when
 * the source no longer resolves an array containing `index`.
 */
export function buildMapChildContext(
  instance: WorkflowInstance,
  mapStep: MapWorkflowStep,
  index: number,
): Record<string, unknown> | null {
  const dotIdx = mapStep.source.indexOf('.')
  if (dotIdx <= 0) return null
  const sourceKey = mapStep.source.slice(dotIdx + 1)
  const sourceOutput = instance.stepStates[mapStep.source.slice(0, dotIdx)]?.output
  const items = sourceOutput?.[sourceKey]
  if (!Array.isArray(items) || index < 0 || index >= items.length) return null
  // The source array itself is OMITTED from the child context — spreading it
  // would persist every sibling's item into every child (quadratic growth
  // with width) and crowd the child's own item out of the byte-budgeted
  // dispatch prompt. Children see their item + the rest of the source output.
  const { [sourceKey]: _sourceArray, ...sourceContext } = sourceOutput || {}
  return {
    ...sourceContext,
    [mapStep.item_key ?? 'item']: items[index],
    mapIndex: index,
    mapTotal: items.length,
  }
}

/**
 * Cancel every still-live child instance parented to (taskId, stepId),
 * retiring board tasks for children at index >= keepBelow (the ones a
 * re-fan-out is NOT about to re-create). Children are rediscovered from the
 * instance store, never the parent's cached children[] — a source-step
 * reopen wipes that array while the child instances keep running.
 */
function sweepLiveMapChildren(taskId: string, stepId: string, keepBelow: number, contentDir: string): void {
  const childIdPrefix = `${taskId}--${stepId}--`
  const live = listInstances(undefined, contentDir).filter(
    (inst) => inst.parentTaskId === taskId && inst.parentStepId === stepId &&
      inst.status !== 'complete' && inst.status !== 'cancelled',
  )
  for (const stale of live) {
    cancelInstance(stale.taskId, contentDir)
    const staleIndex = Number(stale.taskId.slice(childIdPrefix.length))
    if (!(staleIndex >= 0 && staleIndex < keepBelow)) {
      moveTaskInStore(stale.taskId, 'done').catch((err) => {
        log.warn('Failed to retire stale map child task', err)
      })
    }
  }
}

/**
 * Reflect a child instance's failure on its parent's map entry so the join
 * shows an honest 'failed' instead of a silently blocked 'in_progress'.
 */
export function markMapChildFailed(childInstance: WorkflowInstance, contentDir: string): void {
  if (!childInstance.parentTaskId || !childInstance.parentStepId) return
  const parent = loadInstance(childInstance.parentTaskId, contentDir)
  const entry = parent?.stepStates[childInstance.parentStepId]?.children
    ?.find((c) => c.childTaskId === childInstance.taskId)
  if (!parent || !entry || entry.status !== 'in_progress') return
  entry.status = 'failed'
  saveInstance(parent, contentDir)
}

/**
 * Fan out a map_workflow step: one child workflow instance per element of the
 * source step's output array. Invalid sources fail typed (map_source_invalid)
 * with zero children spawned; empty arrays complete immediately and advance.
 * Children are ordinary nested-workflow instances — gates, cycle detection,
 * and board visibility come from the existing machinery.
 * See .claude/specs/workflow-map-fanout-design.md.
 */
function fanOutMapStep(
  instance: WorkflowInstance,
  mapStep: MapWorkflowStep,
  def: WorkflowDefinition,
  contentDir: string,
  now: string,
): void {
  const failTyped = (error: string): void => {
    instance.stepStates[mapStep.id] = {
      status: 'failed',
      startedAt: now,
      code: 'map_source_invalid',
      error,
    }
    instance.history.push({ stepId: mapStep.id, status: 'failed', completedAt: now })
    instance.status = 'failed'
    // If this instance is itself a map child, surface the failure upward.
    markMapChildFailed(instance, contentDir)
  }

  const dotIdx = mapStep.source.indexOf('.')
  const sourceStepId = dotIdx > 0 ? mapStep.source.slice(0, dotIdx) : mapStep.source
  const sourceKey = dotIdx > 0 ? mapStep.source.slice(dotIdx + 1) : ''
  const sourceOutput = instance.stepStates[sourceStepId]?.output
  const value = sourceOutput?.[sourceKey]

  // Sweep BEFORE any outcome branch: a re-fan-out after a source rewind must
  // cancel the prior fan-out's live children whether the new source is valid,
  // empty, oversized, or garbage — otherwise a discarded fan-out keeps
  // running (and billing) with its completions dead-ending at the join.
  // keepBelow (board tasks kept for id reuse) applies ONLY when this fan-out
  // will actually spawn — every failure branch retires all board tasks.
  const willSpawn = Array.isArray(value) && value.length > 0 && value.length <= (mapStep.max_children ?? DEFAULT_MAX_CHILDREN)
  sweepLiveMapChildren(instance.taskId, mapStep.id, willSpawn ? value.length : 0, contentDir)

  if (!Array.isArray(value)) {
    const detail = sourceOutput
      ? `key "${sourceKey}" is ${value === undefined ? 'missing' : `a ${typeof value}, not an array`}`
      : `step "${sourceStepId}" has no output`
    failTyped(`source "${mapStep.source}" must resolve to an array; ${detail}`)
    return
  }

  const maxChildren = mapStep.max_children ?? DEFAULT_MAX_CHILDREN
  if (value.length > maxChildren) {
    failTyped(`source array has ${value.length} items, exceeding max_children (${maxChildren}); no children were spawned`)
    return
  }

  if (value.length === 0) {
    // An empty segmentation is a valid outcome — complete and move on.
    const output = { outputs: [] }
    instance.stepStates[mapStep.id] = { status: 'complete', startedAt: now, completedAt: now, output }
    instance.history.push({ stepId: mapStep.id, status: 'complete', completedAt: now, output })
    advanceWorkflow(instance, def, contentDir)
    return
  }

  const childIdPrefix = `${instance.taskId}--${mapStep.id}--`
  const total = value.length
  const childDef = loadDefinition(mapStep.workflow_id, contentDir)
  const children: MapChildEntry[] = []
  for (let i = 0; i < total; i++) {
    const childTaskId = `${childIdPrefix}${i}`
    const childParentContext = buildMapChildContext(instance, mapStep, i) ?? {}
    const childInstance = createInstance(childTaskId, mapStep.workflow_id, contentDir, instance.resolvedAgent, childParentContext, instance.availableAgents)
    childInstance.parentTaskId = instance.taskId
    childInstance.parentStepId = mapStep.id
    saveInstance(childInstance, contentDir)
    createBoardTaskForChild(childTaskId, instance.taskId, mapStep, childDef, childInstance, { index: i, total })
    // A child can fail during its own createInstance (e.g. a defensive
    // first-step map failure) — record an honest entry, never in_progress.
    children.push({ index: i, childTaskId, status: childInstance.status === 'failed' ? 'failed' : 'in_progress' })
  }
  instance.stepStates[mapStep.id] = { status: 'in_progress', startedAt: now, children }
}

// ─── Step Completion ────────────────────────────────────────────────────────

export interface CompleteStepResult {
  success: boolean
  errors?: string[]
  /**
   * Typed failure discriminant. 'rejection_repeat' = the near-duplicate
   * resubmission detector fired. Callers branch on this, never on the
   * error-message text.
   */
  code?: 'rejection_repeat'
  /** Mirrors getCurrentStep's union (StepContext or a typed status object). */
  nextStep?: Exclude<ReturnType<typeof getCurrentStep>, null>
  workflowComplete?: boolean
}

/**
 * Complete a step with output. Validates output against schema before advancing.
 */
export function completeStep(
  taskId: string,
  stepId: string,
  output: Record<string, unknown>,
  callerAgentId?: string,
  contentDir?: string
): CompleteStepResult {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return { success: false, errors: ['Workflow instance not found'] }
  // Fail closed on every submission surface (REST, exec tool, hooks): a
  // cancelled instance keeps its stepStates at in_progress, so without this
  // guard a late submission would advance a cancelled workflow (#604 review).
  if (instance.status === 'cancelled') {
    return { success: false, errors: ['Workflow is cancelled — no further submissions are accepted. Stop work on this task.'] }
  }

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return { success: false, errors: ['Workflow definition not found'] }

  const stepState = instance.stepStates[stepId]
  if (!stepState) return { success: false, errors: [`Unknown step: ${stepId}`] }
  if (stepState.status !== 'in_progress') {
    return { success: false, errors: [`Step "${stepId}" is not in_progress (current: ${stepState.status})`] }
  }

  // Resolve output schema for validation
  const step = findStep(def, stepId)
  if (!step) return { success: false, errors: [`Step not found in definition: ${stepId}`] }

  // Container steps complete only through their own machinery — a direct
  // submission against a map step would bypass the join while its children
  // keep running (their outputs then silently discarded).
  if (step.type === 'map_workflow') {
    return { success: false, errors: [`Step "${stepId}" is a map fan-out — it completes when all of its children complete. Work the child tasks instead.`] }
  }

  // Agent-scoping: verify the caller is the agent assigned to this step
  if (callerAgentId) {
    const rawAgent = (step as AgentStep | OutputStep).agent
    const assignedAgent = resolveAgent(rawAgent, instance, step.id)
    if (assignedAgent && assignedAgent !== '$assigned' && callerAgentId !== assignedAgent) {
      return { success: false, errors: [`Step "${stepId}" is assigned to "${assignedAgent}", not "${callerAgentId}". Stay in your lane.`] }
    }
  }

  let outputSchema: Record<string, unknown> | undefined
  const skillName = (step as AgentStep | OutputStep).skill
  if (skillName) {
    const skill = loadSkill(skillName, dir)
    if (skill?.output_schema) outputSchema = skill.output_schema
  }

  // Validate output against schema
  const validation = validateStepOutput(outputSchema, output)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  // Rejection-repeat detection: reject near-duplicate resubmissions
  if (stepState.previousOutput) {
    const repeatError = detectRejectionRepeat(stepState.previousOutput, output)
    if (repeatError) {
      return { success: false, errors: [repeatError], code: 'rejection_repeat' }
    }
  }

  // Mark step complete
  const now = new Date().toISOString()
  stepState.status = 'complete'
  stepState.completedAt = now
  stepState.output = output

  instance.history.push({
    stepId,
    status: 'complete',
    completedAt: now,
    output,
  })

  // Notify step completion
  notifyStepComplete(instance, stepId, step.label || stepId)

  // Advance the workflow
  advanceWorkflow(instance, def, dir)
  saveInstance(instance, dir)

  if (instance.status === 'complete') {
    notifyWorkflowComplete(instance)

    // If this is a child workflow, propagate completion to parent
    if (instance.parentTaskId && instance.parentStepId) {
      propagateChildCompletion(instance, dir)
      return { success: true, workflowComplete: true }
    }

    // Auto-move the task to done on the taskboard + emit audit event.
    completeTaskViaHooks(instance, 'inProgress').catch((err) => {
      log.warn('Failed to complete task after workflow completion', err)
    })
    return { success: true, workflowComplete: true }
  }

  const nextStep = getCurrentStep(taskId, undefined, dir)
  return { success: true, nextStep: nextStep || undefined }
}

/**
 * When a child workflow completes, mark the parent's workflow step as complete
 * and advance the parent workflow. Collects the child's final step outputs
 * as the workflow step's output.
 */
export function propagateChildCompletion(childInstance: WorkflowInstance, contentDir: string): void {
  const parentInstance = loadInstance(childInstance.parentTaskId!, contentDir)
  if (!parentInstance) return

  const parentDef = loadDefinition(parentInstance.workflowId, contentDir)
  if (!parentDef) return

  const stepId = childInstance.parentStepId!
  const stepState = parentInstance.stepStates[stepId]
  if (!stepState || stepState.status !== 'in_progress') return

  // Collect child workflow outputs in definition order.
  // `finalOutput` is the last agent step's output (gates don't produce output).
  const childDef = loadDefinition(childInstance.workflowId, contentDir)
  const childOutputs: Record<string, unknown> = {}
  let finalOutput: Record<string, unknown> | undefined
  const defStepIds = childDef
    ? childDef.steps.map(s => s.id)
    : Object.keys(childInstance.stepStates)
  for (const sid of defStepIds) {
    const state = childInstance.stepStates[sid]
    if (state?.output) {
      childOutputs[sid] = state.output
      finalOutput = state.output
    }
  }

  const now = new Date().toISOString()
  const moveChildBoardTaskDone = (): void => {
    addTaskLogToStore(childInstance.taskId, 'workflow', `Sub-workflow "${childInstance.workflowId}" completed.`)
      .then(() => moveTaskInStore(childInstance.taskId, 'done'))
      .catch((err) => { log.warn('Failed to complete child workflow task', err) })
  }

  if (findStep(parentDef, stepId)?.type === 'map_workflow') {
    // Map join: update THIS child's entry; the step only completes when every
    // sibling is complete, aggregating in stable source order regardless of
    // completion order. Failed/cancelled siblings block the join — no cascade.
    const children = stepState.children ?? []
    const entry = children.find((c) => c.childTaskId === childInstance.taskId)
    if (!entry || entry.status === 'complete') return
    entry.status = 'complete'
    entry.output = finalOutput
    moveChildBoardTaskDone()

    if (!children.every((c) => c.status === 'complete')) {
      saveInstance(parentInstance, contentDir)
      return
    }

    stepState.status = 'complete'
    stepState.completedAt = now
    stepState.output = {
      outputs: [...children].sort((a, b) => a.index - b.index).map((c) => c.output ?? {}),
    }
    parentInstance.history.push({
      stepId,
      status: 'complete',
      completedAt: now,
      output: stepState.output,
    })
  } else {
    stepState.status = 'complete'
    stepState.completedAt = now
    stepState.output = { childWorkflowId: childInstance.workflowId, finalOutput, outputs: childOutputs }

    parentInstance.history.push({
      stepId,
      status: 'complete',
      completedAt: now,
      output: stepState.output,
    })

    // Move the child's board task to Done.
    moveChildBoardTaskDone()
  }

  advanceWorkflow(parentInstance, parentDef, contentDir)
  saveInstance(parentInstance, contentDir)

  // If parent also completed, recurse (handles deeply nested workflows)
  if (parentInstance.status === 'complete') {
    if (parentInstance.parentTaskId && parentInstance.parentStepId) {
      propagateChildCompletion(parentInstance, contentDir)
    } else {
      notifyWorkflowComplete(parentInstance)
      completeTaskViaHooks(parentInstance, 'inProgress').catch((err) => {
        log.warn('Failed to complete parent workflow task', err)
      })
    }
  }
}

// ─── Workflow Advancement ───────────────────────────────────────────────────

/**
 * Determine and activate the next step in the workflow.
 *
 * Parallel join semantics:
 * - A parallel group is only complete when ALL its children are complete.
 * - When a child completes, we check if siblings are done.
 * - If all children are done, the parallel group itself is marked complete
 *   and the workflow advances to the next top-level step.
 */
export function advanceWorkflow(instance: WorkflowInstance, def: WorkflowDefinition, contentDir: string): boolean {
  const now = new Date().toISOString()

  // Check if the current top-level step is complete
  const currentTopIdx = getTopLevelIndex(def, instance.currentStepId)
  if (currentTopIdx === -1) return false

  const currentTopStep = def.steps[currentTopIdx]

  // For parallel steps, check if all children are complete
  if (currentTopStep.type === 'parallel') {
    const parallel = currentTopStep as ParallelStep
    const allChildrenDone = parallel.steps.every(
      c => instance.stepStates[c.id]?.status === 'complete'
    )
    if (!allChildrenDone) return false

    // Mark the parallel group itself as complete
    instance.stepStates[parallel.id] = {
      ...instance.stepStates[parallel.id],
      status: 'complete',
      completedAt: now,
    }
  } else if (instance.stepStates[currentTopStep.id]?.status !== 'complete') {
    return false
  }

  // Move to next top-level step
  const nextIdx = currentTopIdx + 1
  if (nextIdx >= def.steps.length) {
    // Workflow is complete
    instance.status = 'complete'
    return true
  }

  const nextStep = def.steps[nextIdx]
  instance.currentStepId = nextStep.id

  if (nextStep.type === 'parallel') {
    // Start all parallel children
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now }
    for (const child of (nextStep as ParallelStep).steps) {
      instance.stepStates[child.id] = { status: 'in_progress', startedAt: now }
      if (child.type === 'agent') {
        const agentName = (child as AgentStep).agent || instance.resolvedAgent || 'unknown'
        notifyStepDispatched(instance, child.id, agentName, child.label)
      }
    }
  } else if (nextStep.type === 'workflow') {
    // Nested workflow — spawn a child instance with parent context
    const nested = nextStep as NestedWorkflowStep
    const childTaskId = `${instance.taskId}--${nested.id}`

    // Collect the most recent prior step output to inject as parent context
    let priorStepOutput: Record<string, unknown> | undefined
    const allSteps = def.steps.flatMap(s => s.type === 'parallel' ? (s as ParallelStep).steps : [s])
    const nextIdx = allSteps.findIndex(s => s.id === nextStep.id)
    for (let i = nextIdx - 1; i >= 0; i--) {
      const priorState = instance.stepStates[allSteps[i].id]
      if (priorState?.output) {
        priorStepOutput = priorState.output
        break
      }
    }

    const childParentContext: Record<string, unknown> = {
      ...(priorStepOutput || {}),
    }

    const childInstance = createInstance(childTaskId, nested.workflow_id, contentDir, instance.resolvedAgent, childParentContext, instance.availableAgents)
    childInstance.parentTaskId = instance.taskId
    childInstance.parentStepId = nested.id
    saveInstance(childInstance, contentDir)
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now, childTaskId }

    // Create a board task so the child workflow's gates are visible in the UI
    const childDef = loadDefinition(nested.workflow_id, contentDir)
    createBoardTaskForChild(childTaskId, instance.taskId, nested, childDef, childInstance)
  } else if (nextStep.type === 'map_workflow') {
    // Dynamic fan-out — one child instance per source-array element.
    fanOutMapStep(instance, nextStep as MapWorkflowStep, def, contentDir, now)
  } else if (nextStep.type === 'gate') {
    // Gates go to pending_approval and record requestedAt so the decision
    // timeline can be computed later.
    instance.stepStates[nextStep.id] = {
      status: 'pending_approval',
      startedAt: now,
      requestedAt: now,
    }
    instance.status = 'pending_approval'

    // Gather prior step output for reviewer context
    const priorStep = def.steps[nextIdx - 1]
    const priorOutput = priorStep ? instance.stepStates[priorStep.id]?.output : undefined
    notifyGateReached(instance, nextStep.id, nextStep.label || nextStep.id, priorOutput)

    // Send a runtime-rendered gate approval alert (fire-and-forget).
    const channelSettings = getGateNotificationSettings()
    if (channelSettings?.approvalChannelAlerts) {
      sendGateApprovalRequest(instance, nextStep.id, nextStep.label || nextStep.id, priorOutput, channelSettings)
        .then((approvalRef) => {
          if (!approvalRef) return
          // Reload instance from disk to avoid overwriting concurrent changes.
          const fresh = loadInstance(instance.taskId, contentDir)
          if (fresh) {
            fresh.stepStates[nextStep.id].approvalRef = approvalRef
            saveInstance(fresh, contentDir)
          }
        })
        .catch((err) => { log.warn('Gate approval alert failed', err) })
    }

    // Move the task to the review column while awaiting approval.
    moveWorkflowTaskToReview(instance.taskId).catch((err) => {
      log.warn('Failed to move workflow task to review', err)
    })
  } else if (isPluginKind(nextStep.type)) {
    // Plugin-owned node kind — mark in_progress and dispatch via hook.
    // The owning plugin is responsible for driving completion.
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now }
    dispatchPluginNode(instance, nextStep, contentDir)
  } else if (nextStep.type === 'createTask') {
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now }
    dispatchCreateTaskNode(instance, nextStep as CreateTaskStep, contentDir)
  } else {
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now }
    // Notify that a step has been dispatched to an agent
    if (nextStep.type === 'agent' || nextStep.type === 'output') {
      const agentName = (nextStep as AgentStep).agent || instance.resolvedAgent || 'unknown'
      notifyStepDispatched(instance, nextStep.id, agentName, nextStep.label)
    }
  }

  return true
}

/**
 * Cancel a workflow instance and any active child instances.
 * Called when a task is moved to done/blocked/deleted outside the workflow.
 */
export function cancelInstance(taskId: string, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return
  if (instance.status === 'complete' || instance.status === 'cancelled') return

  instance.status = 'cancelled'
  instance.updatedAt = new Date().toISOString()

  // Cancel any active child instances and their board tasks
  for (const [, state] of Object.entries(instance.stepStates)) {
    if (state.childTaskId && state.status === 'in_progress') {
      cancelInstance(state.childTaskId, dir)
      // Remove the child from active work.
      moveTaskInStore(state.childTaskId, 'done').catch((err) => {
        log.warn('Failed to move cancelled child workflow task', err)
      })
    }
    // Map fan-out children: sweep every still-live entry.
    for (const child of state.children ?? []) {
      if (child.status !== 'in_progress') continue
      cancelInstance(child.childTaskId, dir)
      child.status = 'cancelled'
      moveTaskInStore(child.childTaskId, 'done').catch((err) => {
        log.warn('Failed to move cancelled map child task', err)
      })
    }
  }

  // Stray-child rediscovery: a source-step reopen wipes the map step's
  // children[] while the child instances keep running — the bookkeeping
  // loops above can't see those. Sweep anything in the store still claiming
  // this instance as parent so cancellation never orphans live children.
  // Gated on the definition actually containing a map step: cancelInstance
  // is on the common path (every done/blocked/deleted task) and the store
  // scan would otherwise run for every plain workflow — and once per child
  // in a fan-out's own recursive cancellation.
  const def = loadDefinition(instance.workflowId, dir)
  const mayHaveMapChildren = !def || def.steps.some((s) => s.type === 'map_workflow')
  if (mayHaveMapChildren) {
    const strays = listInstances(undefined, dir).filter(
      (child) => child.parentTaskId === taskId &&
        child.status !== 'complete' && child.status !== 'cancelled',
    )
    for (const stray of strays) {
      cancelInstance(stray.taskId, dir)
      moveTaskInStore(stray.taskId, 'done').catch((err) => {
        log.warn('Failed to retire stray child task on cancel', err)
      })
    }
  }

  saveInstance(instance, dir)
}
