/**
 * Workflow Runtime Engine
 *
 * Enforces step-by-step agent execution through information gating.
 * Agents only ever see their current step and cannot advance until
 * Beacon validates their output and releases the next step.
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
  SkillDefinition,
} from './types'
import { loadDefinition } from './parser'
import { loadSkill } from './skill-loader'
import { validateStepOutput, detectRejectionRepeat } from './schema-validator'
import { getContentDir } from './content-dir'

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
  contentDir?: string
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
  }

  saveInstance(instance, dir)
  return instance
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

  if (instance.status === 'complete') {
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

  // Parallel step — find the right child for this agent
  if (step.type === 'parallel') {
    const parallel = step as ParallelStep
    if (agentId) {
      const childStep = parallel.steps.find(
        c => c.type === 'agent' && (c as AgentStep).agent === agentId
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

  // Resolve agent
  if (step.type === 'agent') ctx.agent = (step as AgentStep).agent
  if (step.type === 'output' && (step as OutputStep).agent) ctx.agent = (step as OutputStep).agent

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
    const assignedAgent = (step as AgentStep | OutputStep).agent
    if (assignedAgent && callerAgentId !== assignedAgent) {
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

  // Advance the workflow
  const advanced = advanceWorkflow(instance, def, dir)
  saveInstance(instance, dir)

  if (instance.status === 'complete') {
    return { success: true, workflowComplete: true }
  }

  const nextStep = getCurrentStep(taskId, undefined, dir)
  return { success: true, nextStep: nextStep || undefined }
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
    }
  } else if (nextStep.type === 'gate') {
    // Gates go to pending_approval
    instance.stepStates[nextStep.id] = { status: 'pending_approval', startedAt: now }
    instance.status = 'pending_approval'
  } else {
    instance.stepStates[nextStep.id] = { status: 'in_progress', startedAt: now }
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

  if ((instance.status as string) === 'complete') {
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
  return { success: true, rewoundTo: targetId }
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
 */
export function getActiveAgents(
  taskId: string,
  contentDir?: string
): { agent: string; stepId: string }[] {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance || instance.status !== 'in_progress') return []

  const def = loadDefinition(instance.workflowId, dir)
  if (!def) return []

  const currentStep = findStep(def, instance.currentStepId)
  if (!currentStep) return []

  const agents: { agent: string; stepId: string }[] = []

  if (currentStep.type === 'parallel') {
    for (const child of (currentStep as ParallelStep).steps) {
      if (child.type === 'agent' && instance.stepStates[child.id]?.status === 'in_progress') {
        agents.push({ agent: (child as AgentStep).agent, stepId: child.id })
      }
    }
  } else if (currentStep.type === 'agent') {
    agents.push({ agent: (currentStep as AgentStep).agent, stepId: currentStep.id })
  } else if (currentStep.type === 'output' && (currentStep as OutputStep).agent) {
    agents.push({ agent: (currentStep as OutputStep).agent!, stepId: currentStep.id })
  }

  return agents
}
