/**
 * Workflow Runtime Engine
 *
 * Enforces step-by-step agent execution through information gating.
 * Agents only ever see their current step and cannot advance until
 * Bakin validates their output and releases the next step.
 *
 * Key design decisions:
 * - Agents never see future steps (information gating)
 * - Step output is validated against JSON Schema before advancement
 * - Parallel steps dispatch to multiple agents; the join is implicit
 *   (next step only activates when ALL parallel children complete)
 * - Gate steps block until a human approves or rejects
 * - Rejection rewinds to a target step with context
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
  StepState,
  StepHistoryEntry,
  ParallelStep,
  AgentStep,
  GateStep,
  OutputStep,
  NestedWorkflowStep,
  SkillDefinition,
} from '../types'
import { loadDefinition } from './parser'
import { loadSkill } from './skill-loader'
import { validateStepOutput, detectRejectionRepeat } from './schema-validator'
import { notifyGateReached, notifyGateApproved, notifyGateRejected, notifyWorkflowComplete, notifyStepDispatched, notifyStepComplete } from './notifications'
import { getContentDir } from './content-dir'

/**
 * Create a board task for a nested workflow so it's visible in the UI.
 * Fire-and-forget — the workflow instance is the source of truth;
 * the board task is just for visibility and gate approvals.
 */
function createBoardTaskForChild(
  childTaskId: string,
  parentTaskId: string,
  nestedStep: NestedWorkflowStep,
  childDef: WorkflowDefinition | null,
  assignee?: string,
) {
  import('../../tasks/lib/taskboard').then(({ createTask, addTaskLog }) => {
    const title = `${nestedStep.label || nestedStep.workflow_id} (sub-workflow)`
    const description = nestedStep.description || childDef?.description || undefined
    // Find the first agent step in the child workflow for the assignee
    const childAgent = childDef?.steps.find(s => s.type === 'agent')
    const agent = childAgent ? (childAgent as AgentStep).agent : assignee
    const resolvedAgent = agent === '$assigned' ? assignee : agent

    createTask(
      title,
      'inProgress',
      resolvedAgent,
      description?.trim(),
      nestedStep.workflow_id,
      'workflow',
      childTaskId,
    ).then(() => {
      addTaskLog(childTaskId, 'workflow', `Sub-workflow of task ${parentTaskId}`).catch(() => {})
    }).catch(() => {})
  }).catch(() => {})
}

function generateId(): string {
  return 'wf_' + randomBytes(6).toString('hex')
}

function getInstancesDir(contentDir: string): string {
  return join(contentDir, 'workflows', 'instances')
}

function getInstancePath(contentDir: string, taskId: string): string {
  return join(getInstancesDir(contentDir), `${taskId}.json`)
}

/**
 * Flatten all step IDs from a workflow definition (including parallel children).
 */
function flattenSteps(steps: WorkflowStep[]): { id: string; step: WorkflowStep; parentId?: string }[] {
  const result: { id: string; step: WorkflowStep; parentId?: string }[] = []
  for (const step of steps) {
    result.push({ id: step.id, step })
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        result.push({ id: child.id, step: child, parentId: step.id })
      }
    }
  }
  return result
}

/**
 * Find a step by ID in a workflow definition.
 */
function findStep(def: WorkflowDefinition, stepId: string): WorkflowStep | null {
  for (const step of def.steps) {
    if (step.id === stepId) return step
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        if (child.id === stepId) return child
      }
    }
  }
  return null
}

/**
 * Find the parent parallel step for a child step.
 */
function findParentParallel(def: WorkflowDefinition, stepId: string): ParallelStep | null {
  for (const step of def.steps) {
    if (step.type === 'parallel') {
      const parallel = step as ParallelStep
      for (const child of parallel.steps) {
        if (child.id === stepId) return parallel
      }
    }
  }
  return null
}

/**
 * Get the top-level step index (in definition.steps array) for a step ID.
 */
function getTopLevelIndex(def: WorkflowDefinition, stepId: string): number {
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]
    if (step.id === stepId) return i
    if (step.type === 'parallel') {
      for (const child of (step as ParallelStep).steps) {
        if (child.id === stepId) return i
      }
    }
  }
  return -1
}

// ─── Instance Persistence ───────────────────────────────────────────────────

export function loadInstance(taskId: string, contentDir?: string): WorkflowInstance | null {
  const dir = contentDir || getContentDir()
  const path = getInstancePath(dir, taskId)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as WorkflowInstance
}

export function saveInstance(instance: WorkflowInstance, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const instancesDir = getInstancesDir(dir)
  if (!existsSync(instancesDir)) mkdirSync(instancesDir, { recursive: true })
  instance.updatedAt = new Date().toISOString()
  writeFileSync(getInstancePath(dir, instance.taskId), JSON.stringify(instance, null, 2), 'utf-8')
}

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
): WorkflowInstance {
  const dir = contentDir || getContentDir()
  const def = loadDefinition(workflowId, dir)
  if (!def) throw new Error(`Workflow definition not found: ${workflowId}`)

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
    parentContext,
  }

  saveInstance(instance, dir)

  // If the first step is a nested workflow, spawn the child instance now
  if (firstStep.type === 'workflow') {
    const nested = firstStep as NestedWorkflowStep
    const childTaskId = `${taskId}--${nested.id}`
    const childInstance = createInstance(childTaskId, nested.workflow_id, dir, assignee, parentContext)
    childInstance.parentTaskId = taskId
    childInstance.parentStepId = nested.id
    saveInstance(childInstance, dir)
    instance.stepStates[firstStepId] = { status: 'in_progress', startedAt: now, childTaskId }
    saveInstance(instance, dir)

    // Create a board task so the child workflow's gates are visible in the UI
    const childDef = loadDefinition(nested.workflow_id, dir)
    createBoardTaskForChild(childTaskId, taskId, nested, childDef, assignee)
  }

  return instance
}

/**
 * Resolve a step's agent value, replacing `$assigned` with the instance's
 * snapshotted assignee (locked at workflow start to prevent mid-workflow drift).
 */
function resolveAgent(agentValue: string | undefined, instance: WorkflowInstance): string | undefined {
  if (agentValue === '$assigned') return instance.resolvedAgent || agentValue
  return agentValue
}

// ─── Step Context ───────────────────────────────────────────────────────────

export interface StepContext {
  stepId: string
  label: string
  type: string
  agent?: string
  instructions?: string
  output_schema?: Record<string, unknown>
  status: string
  rejectionReason?: string
  previousOutput?: Record<string, unknown>
  /** Output from the immediately prior step — gives this step the context of what came before */
  priorStepOutput?: Record<string, unknown>
  /** All completed step outputs keyed by step ID — accumulated context across the workflow */
  stepOutputs?: Record<string, Record<string, unknown>>
  deny_tools?: string[]
}

/**
 * Get the current step context for a task.
 * Returns ONLY the current step — never future steps (information gating).
 *
 * For parallel steps: if agentId is provided, returns only that agent's step.
 * Otherwise returns the parallel group info.
 */
export function getCurrentStep(
  taskId: string,
  agentId?: string,
  contentDir?: string
): StepContext | { status: 'complete' } | { status: 'pending_approval'; stepId: string; label: string } | null {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return null

  if (instance.status === 'complete' || instance.status === 'cancelled') {
    return { status: 'complete' }
  }

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return null

  const currentId = instance.currentStepId
  const step = findStep(def, currentId)
  if (!step) return null

  // Gate pending approval
  if (step.type === 'gate' && instance.stepStates[currentId]?.status === 'pending_approval') {
    return {
      status: 'pending_approval',
      stepId: currentId,
      label: step.label,
    }
  }

  // Nested workflow step — delegate to the child instance
  if (step.type === 'workflow') {
    const stepState = instance.stepStates[currentId]
    if (stepState?.childTaskId) {
      return getCurrentStep(stepState.childTaskId, agentId, dir)
    }
    return null
  }

  // Parallel step — find the right child for this agent
  if (step.type === 'parallel') {
    const parallel = step as ParallelStep
    if (agentId) {
      const childStep = parallel.steps.find(
        c => c.type === 'agent' && resolveAgent((c as AgentStep).agent, instance) === agentId
      )
      if (childStep && instance.stepStates[childStep.id]?.status === 'in_progress') {
        return buildStepContext(childStep, instance, dir)
      }
    }
    // Return first in_progress child
    for (const child of parallel.steps) {
      if (instance.stepStates[child.id]?.status === 'in_progress') {
        return buildStepContext(child, instance, dir)
      }
    }
  }

  return buildStepContext(step, instance, dir)
}

function buildStepContext(
  step: WorkflowStep,
  instance: WorkflowInstance,
  contentDir: string
): StepContext {
  const ctx: StepContext = {
    stepId: step.id,
    label: step.label,
    type: step.type,
    status: instance.stepStates[step.id]?.status || 'pending',
  }

  // Resolve agent (handles $assigned → snapshotted assignee)
  if (step.type === 'agent') ctx.agent = resolveAgent((step as AgentStep).agent, instance)
  if (step.type === 'output' && (step as OutputStep).agent) ctx.agent = resolveAgent((step as OutputStep).agent, instance)

  // Resolve instructions from skill or description
  const skillName = (step as AgentStep | OutputStep).skill
  const description = (step as AgentStep | OutputStep).description

  if (skillName) {
    const skill = loadSkill(skillName, contentDir)
    if (skill) {
      ctx.instructions = skill.instructions
      if (description) ctx.instructions += `\n\n${description}`
      if (skill.output_schema) ctx.output_schema = skill.output_schema
    } else {
      // Skill not found, fall back to description
      ctx.instructions = description
    }
  } else {
    ctx.instructions = description
  }

  // Collect all completed step outputs and find the most recent one
  const def = loadDefinition(instance.workflowId, contentDir)
  if (def) {
    const flatSteps = def.steps.flatMap(s =>
      s.type === 'parallel' ? (s as ParallelStep).steps : [s]
    )
    const stepIdx = flatSteps.findIndex(s => s.id === step.id)

    // Build accumulated outputs map from all prior completed steps
    const stepOutputs: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < stepIdx; i++) {
      const priorState = instance.stepStates[flatSteps[i].id]
      if (priorState?.output) {
        stepOutputs[flatSteps[i].id] = priorState.output
      }
    }

    // Include parent context as a special key so child workflows see upstream data
    if (instance.parentContext) {
      stepOutputs['__parentContext'] = instance.parentContext
    }

    if (Object.keys(stepOutputs).length > 0) {
      ctx.stepOutputs = stepOutputs
    }

    // Also set priorStepOutput to the most recent completed step with output
    for (let i = stepIdx - 1; i >= 0; i--) {
      const priorState = instance.stepStates[flatSteps[i].id]
      if (priorState?.output) {
        ctx.priorStepOutput = priorState.output
        break
      }
    }

    // If no prior step output but we have parent context, use that
    if (!ctx.priorStepOutput && instance.parentContext) {
      ctx.priorStepOutput = instance.parentContext
    }
  }

  // Include rejection context if step was previously rejected
  const stepState = instance.stepStates[step.id]
  if (stepState?.rejectionReason) {
    ctx.rejectionReason = stepState.rejectionReason
  }
  if (stepState?.previousOutput) {
    ctx.previousOutput = stepState.previousOutput
  }

  // Include tool restrictions from step definition
  if (step.type === 'agent' || step.type === 'output') {
    const denyTools = (step as AgentStep | OutputStep).deny_tools
    if (denyTools?.length) {
      ctx.deny_tools = denyTools
    }
  }

  return ctx
}

// ─── Step Completion ────────────────────────────────────────────────────────

export interface CompleteStepResult {
  success: boolean
  errors?: string[]
  nextStep?: StepContext | { status: 'complete' } | { status: 'pending_approval'; stepId: string; label: string }
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

  // Agent-scoping: verify the caller is the agent assigned to this step
  if (callerAgentId) {
    const rawAgent = (step as AgentStep | OutputStep).agent
    const assignedAgent = resolveAgent(rawAgent, instance)
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
      return { success: false, errors: [repeatError] }
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
  const advanced = advanceWorkflow(instance, def, dir)
  saveInstance(instance, dir)

  if (instance.status === 'complete') {
    notifyWorkflowComplete(instance)

    // If this is a child workflow, propagate completion to parent
    if (instance.parentTaskId && instance.parentStepId) {
      propagateChildCompletion(instance, dir)
      return { success: true, workflowComplete: true }
    }

    // Auto-move the task to done on the taskboard + emit audit event
    Promise.all([
      import('../../tasks/lib/taskboard'),
      import('../../../src/core/audit'),
    ]).then(([{ moveTask, addTaskLog, readTaskboard }, { appendAudit }]) => {
      // Resolve task title for the audit message
      let title = instance.taskId
      try {
        const { columns } = readTaskboard()
        for (const col of Object.values(columns)) {
          const found = (col as Array<{ id: string; title: string }>).find(t => t.id === instance.taskId)
          if (found) { title = found.title; break }
        }
      } catch { /* best effort */ }
      addTaskLog(instance.taskId, 'workflow', `Workflow "${instance.workflowId}" completed — all steps done.`)
        .then(() => moveTask(instance.taskId, 'done'))
        .then(() => appendAudit(getContentDir(), 'task.moved', 'workflow', { id: instance.taskId, title, from: 'inProgress', to: 'done' }))
        .catch(() => {})
    }).catch(() => {})
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
function propagateChildCompletion(childInstance: WorkflowInstance, contentDir: string): void {
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
  stepState.status = 'complete'
  stepState.completedAt = now
  stepState.output = { childWorkflowId: childInstance.workflowId, finalOutput, outputs: childOutputs }

  parentInstance.history.push({
    stepId,
    status: 'complete',
    completedAt: now,
    output: stepState.output,
  })

  // Move the child's board task to Done
  import('../../tasks/lib/taskboard').then(({ moveTask, addTaskLog }) => {
    addTaskLog(childInstance.taskId, 'workflow', `Sub-workflow "${childInstance.workflowId}" completed.`)
      .then(() => moveTask(childInstance.taskId, 'done'))
      .catch(() => {})
  }).catch(() => {})

  advanceWorkflow(parentInstance, parentDef, contentDir)
  saveInstance(parentInstance, contentDir)

  // If parent also completed, recurse (handles deeply nested workflows)
  if (parentInstance.status === 'complete') {
    if (parentInstance.parentTaskId && parentInstance.parentStepId) {
      propagateChildCompletion(parentInstance, contentDir)
    } else {
      notifyWorkflowComplete(parentInstance)
      Promise.all([
        import('../../tasks/lib/taskboard'),
        import('../../../src/core/audit'),
      ]).then(([{ moveTask, addTaskLog, readTaskboard }, { appendAudit }]) => {
        let title = parentInstance.taskId
        try {
          const { columns } = readTaskboard()
          for (const col of Object.values(columns)) {
            const found = (col as Array<{ id: string; title: string }>).find(t => t.id === parentInstance.taskId)
            if (found) { title = found.title; break }
          }
        } catch { /* best effort */ }
        addTaskLog(parentInstance.taskId, 'workflow', `Workflow "${parentInstance.workflowId}" completed — all steps done.`)
          .then(() => moveTask(parentInstance.taskId, 'done'))
          .then(() => appendAudit(getContentDir(), 'task.moved', 'workflow', { id: parentInstance.taskId, title, from: 'inProgress', to: 'done' }))
          .catch(() => {})
      }).catch(() => {})
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
function advanceWorkflow(instance: WorkflowInstance, def: WorkflowDefinition, contentDir: string): boolean {
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

    // Always include parent task metadata so child has full context
    let parentTaskTitle: string | undefined
    let parentTaskDescription: string | undefined
    try {
      const tbPath = join(contentDir, 'TASKBOARD.md')
      if (existsSync(tbPath)) {
        const { parseTasks } = require('../../plugins/tasks/parser')
        const board = parseTasks(readFileSync(tbPath, 'utf8'))
        for (const tasks of Object.values(board.columns)) {
          const found = (tasks as Array<{ id: string; title?: string; description?: string }>).find(t => t.id === instance.taskId)
          if (found) {
            parentTaskTitle = found.title
            parentTaskDescription = found.description
            break
          }
        }
      }
    } catch { /* best effort */ }

    const childParentContext: Record<string, unknown> = {
      ...(priorStepOutput || {}),
      _parentTaskTitle: parentTaskTitle,
      _parentTaskDescription: parentTaskDescription,
    }

    const childInstance = createInstance(childTaskId, nested.workflow_id, contentDir, instance.resolvedAgent, childParentContext)
    childInstance.parentTaskId = instance.taskId
    childInstance.parentStepId = nested.id
    saveInstance(childInstance, contentDir)
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now, childTaskId }

    // Create a board task so the child workflow's gates are visible in the UI
    const childDef = loadDefinition(nested.workflow_id, contentDir)
    createBoardTaskForChild(childTaskId, instance.taskId, nested, childDef, instance.resolvedAgent)
  } else if (nextStep.type === 'gate') {
    // Gates go to pending_approval
    instance.stepStates[nextStep.id] = { status: 'pending_approval', startedAt: now }
    instance.status = 'pending_approval'

    // Gather prior step output for reviewer context
    const priorStep = def.steps[nextIdx - 1]
    const priorOutput = priorStep ? instance.stepStates[priorStep.id]?.output : undefined
    notifyGateReached(instance, nextStep.id, nextStep.label || nextStep.id, priorOutput)

    // Move the task to the review column while awaiting approval
    import('../../tasks/lib/taskboard').then(({ moveTask }) => {
      moveTask(instance.taskId, 'review').catch(() => {})
    }).catch(() => {})
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

// ─── Gate Operations ────────────────────────────────────────────────────────

/**
 * Approve a gate step, advancing the workflow past it.
 */
export function approveGate(
  taskId: string,
  stepId: string,
  contentDir?: string
): { success: boolean; errors?: string[]; nextStep?: ReturnType<typeof getCurrentStep> | undefined } {
  const dir = contentDir || getContentDir()
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

  // Mark gate as complete
  const now = new Date().toISOString()
  stepState.status = 'complete'
  stepState.completedAt = now

  instance.history.push({
    stepId,
    status: 'complete',
    completedAt: now,
  })

  instance.status = 'in_progress'
  advanceWorkflow(instance, def, dir)
  saveInstance(instance, dir)

  // Emit SSE event and clear notification tracking
  notifyGateApproved(instance, stepId, step.label || stepId)
  clearGateNotified(taskId, stepId, dir)

  // Log gate approval to the task so watchdog sees recent activity
  // and move it back to inProgress (from review) unless the workflow just completed
  import('../../tasks/lib/taskboard').then(({ addTaskLog, moveTask }) => {
    addTaskLog(taskId, 'workflow', `Gate "${step.label || stepId}" approved — advancing workflow.`)
      .then(() => {
        if ((instance.status as string) !== 'complete') {
          return moveTask(taskId, 'inProgress').catch(() => {})
        }
      })
      .catch(() => {})
  }).catch(() => {})

  if ((instance.status as string) === 'complete') {
    notifyWorkflowComplete(instance)

    // If this is a child workflow, propagate completion to parent
    if (instance.parentTaskId && instance.parentStepId) {
      propagateChildCompletion(instance, dir)
      return { success: true, nextStep: { status: 'complete' } }
    }

    // Auto-move the task to done on the taskboard + emit audit event
    Promise.all([
      import('../../tasks/lib/taskboard'),
      import('../../../src/core/audit'),
    ]).then(([{ moveTask, addTaskLog }, { appendAudit }]) => {
      addTaskLog(instance.taskId, 'workflow', `Workflow "${instance.workflowId}" completed — all steps done.`)
        .then(() => moveTask(instance.taskId, 'done'))
        .then(() => appendAudit(getContentDir(), 'task.moved', 'workflow', { id: instance.taskId, from: 'review', to: 'done' }))
        .catch(() => {})
    }).catch(() => {})
    return { success: true, nextStep: { status: 'complete' } }
  }

  const nextStep = getCurrentStep(taskId, undefined, dir)
  return { success: true, nextStep: nextStep || undefined }
}

/**
 * Reject a gate step, rewinding the workflow to a target step.
 * All steps after the rewind target are reset to 'pending'.
 */
export function rejectGate(
  taskId: string,
  stepId: string,
  reason: string,
  rewindTo?: string,
  contentDir?: string
): { success: boolean; errors?: string[]; rewoundTo?: string } {
  const dir = contentDir || getContentDir()
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
  const targetId = rewindTo || gateStep.on_reject?.goto
  if (!targetId) {
    return { success: false, errors: ['No rewind target specified and gate has no on_reject.goto'] }
  }

  const targetStep = findStep(def, targetId)
  if (!targetStep) {
    return { success: false, errors: [`Rewind target step not found: ${targetId}`] }
  }

  // Record rejection in history
  const now = new Date().toISOString()
  instance.history.push({
    stepId,
    status: 'rejected',
    completedAt: now,
    rejectionReason: reason,
  })

  // Reset: mark gate as rejected
  stepState.status = 'rejected'

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
  notifyGateRejected(instance, stepId, step.label || stepId, reason)
  clearGateNotified(taskId, stepId, dir)

  // Log gate rejection and move task back to inProgress (from review)
  import('../../tasks/lib/taskboard').then(({ addTaskLog, moveTask }) => {
    addTaskLog(taskId, 'workflow', `Gate "${step.label || stepId}" rejected: ${reason}`)
      .then(() => moveTask(taskId, 'inProgress'))
      .catch(() => {})
  }).catch(() => {})

  return { success: true, rewoundTo: targetId }
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
      // Remove the child's board task
      import('../../tasks/lib/taskboard').then(({ moveTask }) => {
        moveTask(state.childTaskId!, 'done').catch(() => {})
      }).catch(() => {})
    }
  }

  saveInstance(instance, dir)
}

/**
 * List active workflow instances.
 */
export function listInstances(
  statusFilter?: string,
  contentDir?: string
): WorkflowInstance[] {
  const dir = contentDir || getContentDir()
  const instancesDir = getInstancesDir(dir)
  if (!existsSync(instancesDir)) return []

  const { readdirSync } = require('fs')
  const files = readdirSync(instancesDir).filter((f: string) => f.endsWith('.json'))

  const instances: WorkflowInstance[] = []
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(instancesDir, file), 'utf-8')) as WorkflowInstance
      if (!statusFilter || data.status === statusFilter) {
        instances.push(data)
      }
    } catch {
      // Skip corrupt instance files
    }
  }

  return instances
}

/**
 * Get all agents that should be dispatched for the current step of a workflow.
 * Used by the dispatch system to know who to send work to.
 *
 * `effectiveTaskId` is the task ID to use when communicating with the workflow
 * runtime (e.g., step/complete). For nested workflows this will be the child's
 * synthetic task ID, not the top-level task.
 */
export function getActiveAgents(
  taskId: string,
  contentDir?: string
): { agent: string; stepId: string; effectiveTaskId?: string }[] {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance || instance.status !== 'in_progress') return []

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return []

  const currentStep = findStep(def, instance.currentStepId)
  if (!currentStep) return []

  const agents: { agent: string; stepId: string; effectiveTaskId?: string }[] = []

  if (currentStep.type === 'workflow') {
    // Delegate to child instance — child results include effectiveTaskId
    const stepState = instance.stepStates[currentStep.id]
    if (stepState?.childTaskId) {
      // Check if the child task has been blocked — if so, don't dispatch.
      // Avoids an infinite retry loop where dispatch keeps re-dispatching
      // a blocked child (e.g., API spending cap, external service down).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readTaskboard } = require('../../tasks/lib/taskboard') as { readTaskboard: () => { columns: { blocked: Array<{ id: string }> } } }
        const { columns } = readTaskboard()
        if (columns.blocked.some(t => t.id === stepState.childTaskId)) return []
      } catch {
        // If taskboard read fails, fall through to normal delegation
      }
      return getActiveAgents(stepState.childTaskId, dir).map(a => ({
        ...a,
        effectiveTaskId: a.effectiveTaskId || stepState.childTaskId,
      }))
    }
    return []
  } else if (currentStep.type === 'parallel') {
    for (const child of (currentStep as ParallelStep).steps) {
      if (child.type === 'agent' && instance.stepStates[child.id]?.status === 'in_progress') {
        const resolved = resolveAgent((child as AgentStep).agent, instance)
        if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: child.id })
      }
    }
  } else if (currentStep.type === 'agent') {
    const resolved = resolveAgent((currentStep as AgentStep).agent, instance)
    if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: currentStep.id })
  } else if (currentStep.type === 'output' && (currentStep as OutputStep).agent) {
    const resolved = resolveAgent((currentStep as OutputStep).agent, instance)
    if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: currentStep.id })
  }

  return agents
}

// ─── Gate Notification Tracking ──────────────────────────────────────────────

function getNotifiedGatesPath(contentDir: string): string {
  return join(contentDir, 'workflows', '.notified-gates.json')
}

function loadNotifiedGates(contentDir: string): Record<string, string> {
  const p = getNotifiedGatesPath(contentDir)
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* start fresh */ }
  return {}
}

function saveNotifiedGates(data: Record<string, string>, contentDir: string): void {
  const p = getNotifiedGatesPath(contentDir)
  const dir = join(contentDir, 'workflows')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

export function isGateNotified(taskId: string, stepId: string, contentDir?: string): boolean {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  return `${taskId}:${stepId}` in gates
}

export function markGateNotified(taskId: string, stepId: string, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  gates[`${taskId}:${stepId}`] = new Date().toISOString()
  saveNotifiedGates(gates, dir)
}

export function clearGateNotified(taskId: string, stepId: string, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  delete gates[`${taskId}:${stepId}`]
  saveNotifiedGates(gates, dir)
}
