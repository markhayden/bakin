/**
 * Workflow Step Context (information gating)
 *
 * The read-only query surface: agent resolution, the current-step context an
 * agent is allowed to see, the active-agent dispatch list, and tool-use
 * authorization. None of these mutate instances — the engine and gates import
 * from here, never the reverse (no cycle).
 */
import type {
  WorkflowInstance,
  WorkflowStep,
  ParallelStep,
  AgentStep,
  OutputStep,
  StepErrorCode,
} from '../types'
import { isTeamStepToken } from '@bakin/core/workflows/team-token'
import { loadDefinition, parsePreferredAgentExpression, findStep } from './parser'
import { loadSkill } from './skill-loader'
import { getContentDir } from './content-dir'
import { loadInstance } from './instance-store'

/**
 * Resolve a step's agent value, replacing `$assigned` with the instance's
 * snapshotted assignee (locked at workflow start to prevent mid-workflow
 * drift) and `team:<id>` with the step's sticky resolution when dispatch has
 * recorded one (#611) — an unresolved team token passes through so dispatch
 * can recognize and resolve it.
 */
export function resolveAgent(agentValue: string | undefined, instance: WorkflowInstance, stepId?: string): string | undefined {
  if (isTeamStepToken(agentValue)) {
    return (stepId && instance.teamResolutions?.[stepId]?.agentId) || agentValue
  }
  if (agentValue === '$assigned') return instance.resolvedAgent || agentValue
  const preferred = agentValue ? parsePreferredAgentExpression(agentValue) : null
  if (preferred) {
    // `availableAgents` is a snapshot taken at workflow start. When it is
    // missing — instances rehydrated from disk that predate the snapshot, or
    // a start where the runtime agent list was transiently empty — fall back
    // to accepting the first named choice rather than dropping the owner.
    // Otherwise an unresolved selector returns undefined, which silently
    // degrades preferred routing AND bypasses the step's agent-scoping guard.
    const available = instance.availableAgents ? new Set(instance.availableAgents) : null
    for (const choice of preferred) {
      if (choice === '$assigned') {
        if (instance.resolvedAgent) return instance.resolvedAgent
        continue
      }
      if (!choice.startsWith('$') && (available === null || available.has(choice))) return choice
    }
    return undefined
  }
  return agentValue
}

export function getStepOwner(step: WorkflowStep, instance: WorkflowInstance): string | undefined {
  if (step.type === 'agent') return resolveAgent((step as AgentStep).agent, instance, step.id)
  if (step.type === 'output') return resolveAgent((step as OutputStep).agent, instance, step.id)
  return undefined
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
): StepContext | { status: 'complete' } | { status: 'cancelled' } | { status: 'failed'; stepId: string; code?: StepErrorCode; error?: string } | { status: 'pending_approval'; stepId: string; label: string } | { status: 'fanned_out'; stepId: string; label: string; childrenTotal: number; childrenComplete: number } | null {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance) return null

  // Cancelled is NOT complete: a cancelled instance (task cancelled/moved
  // off the board mid-flight) reports its own honest terminal status — a
  // graceful stop signal for the still-running agent, while completeStep
  // fails closed against any late submission (#604 T6 + review F5).
  // A DELETED task's instance file is gone entirely → null above.
  if (instance.status === 'cancelled') return { status: 'cancelled' }
  if (instance.status === 'complete') {
    return { status: 'complete' }
  }
  // Failed carries the typed code from the failing step (map_source_invalid
  // today) so agents/UIs branch on code, never on error text.
  if (instance.status === 'failed') {
    const failedState = instance.stepStates[instance.currentStepId]
    return {
      status: 'failed',
      stepId: instance.currentStepId,
      code: failedState?.code,
      error: failedState?.error,
    }
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

  // Map fan-out — no single delegate is honest for N children (agents work
  // their child board tasks; getActiveAgents unions them). Returning null
  // here would collide with null's "no workflow instance" meaning on the
  // REST/tool surfaces, so the fan-out reports itself as a typed status.
  if (step.type === 'map_workflow') {
    const entries = instance.stepStates[currentId]?.children ?? []
    return {
      status: 'fanned_out',
      stepId: currentId,
      label: step.label,
      childrenTotal: entries.length,
      childrenComplete: entries.filter((c) => c.status === 'complete').length,
    }
  }

  // Parallel step — find the right child for this agent
  if (step.type === 'parallel') {
    const parallel = step as ParallelStep
    if (agentId) {
      const childStep = parallel.steps.find(
        c => c.type === 'agent' && resolveAgent((c as AgentStep).agent, instance, c.id) === agentId
      )
      if (childStep && instance.stepStates[childStep.id]?.status === 'in_progress') {
        return buildStepContext(childStep, instance, dir)
      }
      return null
    }
    // Return first in_progress child
    for (const child of parallel.steps) {
      if (instance.stepStates[child.id]?.status === 'in_progress') {
        return buildStepContext(child, instance, dir)
      }
    }
  }

  if (agentId) {
    const owner = getStepOwner(step, instance)
    if (!owner || owner === '$assigned' || owner !== agentId) return null
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
  const owner = getStepOwner(step, instance)
  if (owner) ctx.agent = owner

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

export type WorkflowToolUseAction = 'progress-log' | 'task-complete' | 'task-block' | 'channel-post'

export interface WorkflowToolUseAuthorization {
  allowed: boolean
  reason?: string
  step?: StepContext
}

export function authorizeWorkflowToolUse(
  taskId: string,
  agentId: string,
  action: WorkflowToolUseAction,
  contentDir?: string,
): WorkflowToolUseAuthorization {
  const dir = contentDir || getContentDir()
  const instance = loadInstance(taskId, dir)
  if (!instance || instance.status === 'complete' || instance.status === 'cancelled') {
    return { allowed: true }
  }

  if (action === 'task-complete') {
    return {
      allowed: false,
      reason: 'This is an active workflow task. Submit the current workflow step and let the workflow engine complete the task.',
    }
  }

  if (instance.status === 'pending_approval') {
    return {
      allowed: false,
      reason: 'This workflow is waiting on a human approval gate. Agents cannot mutate it until the gate resolves.',
    }
  }

  const step = getCurrentStep(taskId, agentId, dir)
  if (!step || !('type' in step)) {
    return {
      allowed: false,
      reason: `Agent "${agentId}" is not the owner of the active workflow step for task "${taskId}".`,
    }
  }

  if (action === 'channel-post' && step.type !== 'output') {
    return {
      allowed: false,
      reason: 'Workflow channel posts are only allowed from the active output step.',
      step,
    }
  }

  return { allowed: true, step }
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
      return getActiveAgents(stepState.childTaskId, dir).map(a => ({
        ...a,
        effectiveTaskId: a.effectiveTaskId || stepState.childTaskId,
      }))
    }
    return []
  } else if (currentStep.type === 'map_workflow') {
    // Union over every live fan-out child, each under its own child taskId.
    const out: { agent: string; stepId: string; effectiveTaskId?: string }[] = []
    for (const entry of instance.stepStates[currentStep.id]?.children ?? []) {
      if (entry.status !== 'in_progress') continue
      out.push(...getActiveAgents(entry.childTaskId, dir).map(a => ({
        ...a,
        effectiveTaskId: a.effectiveTaskId || entry.childTaskId,
      })))
    }
    return out
  } else if (currentStep.type === 'parallel') {
    for (const child of (currentStep as ParallelStep).steps) {
      if (child.type === 'agent' && instance.stepStates[child.id]?.status === 'in_progress') {
        const resolved = resolveAgent((child as AgentStep).agent, instance, child.id)
        if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: child.id })
      }
    }
  } else if (currentStep.type === 'agent') {
    const resolved = resolveAgent((currentStep as AgentStep).agent, instance, currentStep.id)
    if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: currentStep.id })
  } else if (currentStep.type === 'output' && (currentStep as OutputStep).agent) {
    const resolved = resolveAgent((currentStep as OutputStep).agent, instance, currentStep.id)
    if (resolved && resolved !== '$assigned') agents.push({ agent: resolved, stepId: currentStep.id })
  }

  return agents
}
