/**
 * Workflow-step dispatch: create/advance the instance and dispatch the current
 * step's agent(s), plus the workflow-step prompt builder. Extracted from
 * dispatch.ts. The fire primitives (claim/gate/budget/fire) come from
 * dispatch-turns; moveTaskToInProgress/addTaskLog are injected by the caller
 * (cycle/single) so this module never imports them back.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { getSettings } from './settings'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { readTaskboard } from './task-store'
import { buildTaskLessonQuery } from './agent-packages/lesson-retrieval'
import type { DispatchState, SessionDeathState } from './dispatch-types'
import { getFailureRecord } from './dispatch-state'
import { findDispatchTaskSnapshot } from './dispatch-board'
import { buildDispatchLessonBlock, buildDispatchAssetBlock } from './dispatch-context-blocks'
import { mcporterHelpers, sharedExecutionToolDocs, outputDisciplineSection, buildCorrectiveSection, type PromptSection } from './dispatch-prompts'
import { concurrencyGate, deferForBudget, claimDispatchRun, auditDispatchSuppressed, fireDispatchTurn } from './dispatch-turns'

const log = createLogger('dispatch-workflow')
const hooks = () => getHookRegistry()

/**
 * Dispatch a workflow-backed task. Creates an instance if needed,
 * then sends only the current step's instructions to the assigned agent.
 */
export async function dispatchWorkflowTask(
  task: { id: string; title: string; description?: string; agent?: string; workflowId: string },
  contentDir: string,
  port: number,
  dispatchedSet: Set<string>,
  state: DispatchState,
  moveTaskToInProgress: (id: string, agent: string) => Promise<void>,
  addTaskLog: (id: string, author: string, message: string) => Promise<void>,
  mainAgentId: string,
): Promise<void> {
  // Load or create workflow instance.
  // Pass the task assignee so $assigned steps resolve to whoever owns the task at start time.
  const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
  if (!instance) {
    await hooks().invoke<Record<string, unknown>>('workflows.createInstance', { taskId: task.id, workflowId: task.workflowId, assignee: task.agent })
    log.info('Created workflow instance', { taskId: task.id, workflowId: task.workflowId, resolvedAgent: task.agent })
  } else if (!instance.resolvedAgent && task.agent) {
    // Backfill resolvedAgent if instance was created before $assigned resolution was wired up
    instance.resolvedAgent = task.agent
    await hooks().invoke<void>('workflows.saveInstance', { instance })
    log.info('Backfilled resolvedAgent on existing instance', { taskId: task.id, resolvedAgent: task.agent })
  }

  // Get agents for current step
  const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string; effectiveTaskId?: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
  if (activeAgents.length === 0) {
    log.debug('No active agents for workflow step', { taskId: task.id })
    return
  }

  // Move task to in_progress BEFORE dispatching to agents — same pattern as
  // non-workflow tasks. Prevents the task from sitting in "todo" while the
  // agent is already working on it.
  if (!dispatchedSet.has(task.id)) {
    const { columns: fresh } = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string; agent?: string; title?: string; workflowId?: string }>> }
    const stillInTodo = fresh.todo.some(t => t.id === task.id)
    if (stillInTodo) {
      const ownerAgent = task.agent || activeAgents[0]?.agent || mainAgentId
      await moveTaskToInProgress(task.id, ownerAgent)
      // No task.moved audit: the internal move is folded into the per-step
      // task.dispatched rows emitted below.
    }
    dispatchedSet.add(task.id)
  }

  for (const { agent, stepId, effectiveTaskId } of activeAgents) {
    // For nested workflows, use the child's taskId for step context resolution
    const contextTaskId = effectiveTaskId || task.id
    const stepContext = await hooks().invoke<Record<string, unknown>>('workflows.getCurrentStep', { taskId: contextTaskId, agentId: agent })
    if (!stepContext || 'status' in stepContext && (stepContext.status === 'complete' || stepContext.status === 'pending_approval')) {
      continue
    }

    const ctx = stepContext as {
      stepId: string; label: string; type?: string; instructions?: string;
      output_schema?: Record<string, unknown>; rejectionReason?: string;
      previousOutput?: Record<string, unknown>; priorStepOutput?: Record<string, unknown>;
      stepOutputs?: Record<string, Record<string, unknown>>; deny_tools?: string[]
    }
    const targetAgent = agent
    const lessonBlock = await buildDispatchLessonBlock({
      contentDir,
      taskId: task.id,
      title: task.title,
      agentId: targetAgent,
      query: buildTaskLessonQuery({
        title: task.title,
        description: task.description,
        instructions: ctx.instructions,
        context: ctx.label,
      }),
    })
    // Pass contextTaskId so the step/complete API targets the right instance.
    // A pending session-death recovery injects corrective guidance (workflow
    // steps only get the corrective rung — the engine owns step structure).
    const wfRecovery = getFailureRecord(state.failedDispatches?.[task.id])?.sessionDeath
    // Assets are linked to the PARENT task id (decomposition guidance tells
    // agents to save against the parent), so resolve by task.id, not contextTaskId.
    const wfAssetsBlock = await buildDispatchAssetBlock(task.id)
    const message = buildWorkflowDispatchMessage({ ...task, id: contextTaskId }, ctx, agent, lessonBlock, wfRecovery, wfAssetsBlock)
    const initialLogCount = findDispatchTaskSnapshot(task.id)?.task.log?.length ?? 0

    const gate = concurrencyGate(targetAgent, getSettings())
    if (gate) {
      log.debug('Workflow step dispatch deferred by concurrency gate', { taskId: task.id, stepId, agent: targetAgent, gate })
      continue
    }

    // Spend ceiling — defer the step when a budget cap is hit.
    if (await deferForBudget(targetAgent, contentDir)) {
      log.debug('Workflow step dispatch deferred by budget gate', { taskId: task.id, stepId, agent: targetAgent })
      continue
    }

    // Claim the step's live-run slot (exec key taskId:stepId — parallel
    // step agents on one task are legitimate concurrent runs).
    const claim = claimDispatchRun(task.id, targetAgent, stepId)
    if (!claim.claimed) {
      auditDispatchSuppressed(contentDir, task, targetAgent, claim.liveRunId, 'workflow')
      continue
    }

    const threadId = claim.runId
    dispatchedSet.add(`${task.id}:${stepId}`)
    appendAudit(contentDir, 'task.dispatched', targetAgent, {
      id: task.id,
      title: task.title,
      workflowId: task.workflowId,
      stepId,
      threadId,
      from: 'todo',
      to: 'inProgress',
    })
    log.info('Workflow step dispatched', { taskId: task.id, stepId, agent: targetAgent, threadId })
    fireDispatchTurn({
      marker: `${task.id}:${stepId}`,
      task,
      targetAgent,
      threadId,
      message,
      contentDir,
      port,
      initialLogCount,
      logPrefix: `Workflow dispatch failed for step "${stepId}"`,
      dispatchKind: 'workflow',
    })
  }
}

/**
 * Build a dispatch message for a workflow step.
 * Contains ONLY the current step instructions — never future steps.
 *
 * Structure: identity frame → hard constraints → revision context → task → output → commands → stop.
 * Rules come BEFORE instructions (position primacy — LLMs weight early text more).
 *
 * @internal Exported for testing and the context-report diagnostics.
 */
export function buildWorkflowDispatchSections(
  task: { id: string; title: string; description?: string },
  stepContext: {
    stepId: string
    label: string
    type?: string
    instructions?: string
    output_schema?: Record<string, unknown>
    rejectionReason?: string
    previousOutput?: Record<string, unknown>
    priorStepOutput?: Record<string, unknown>
    stepOutputs?: Record<string, Record<string, unknown>>
    deny_tools?: string[]
  },
  agentName: string,
  lessonBlock = '',
  recovery?: SessionDeathState,
  assetsBlock = '',
): PromptSection[] {
  // Sections are groups of lines; the message is section texts joined by
  // '\n', byte-identical to joining all lines directly (empty groups are
  // skipped, so no boundary gains a stray newline).
  const sections: PromptSection[] = []
  let lines: string[] = []
  const flush = (source: string) => {
    if (lines.length > 0) {
      sections.push({ source, text: lines.join('\n') })
      lines = []
    }
  }
  if (recovery?.stage === 'corrective') {
    lines.push(buildCorrectiveSection(task.id, recovery).trimEnd())
    lines.push('')
  }
  flush('corrective')

  // ─── Identity Frame ─────────────────────────────────────────────────
  lines.push('# WORKFLOW STEP ASSIGNMENT')
  lines.push('')
  lines.push('You are executing a single step in a managed workflow. You are NOT a general assistant right now — you are a workflow step executor.')
  lines.push('')
  lines.push(`**Task:** "${task.title}"`)
  if (task.description) {
    lines.push(`**Context:** ${task.description}`)
  }
  lines.push(`**Your step:** ${stepContext.label} (ID: ${stepContext.stepId})`)
  lines.push(`**Your agent name:** ${agentName}`)
  lines.push('')
  flush('identity')

  // ─── Hard Constraints ───────────────────────────────────────────────
  lines.push('## HARD CONSTRAINTS — violations are rejected server-side')
  lines.push('')
  lines.push('1. **SCOPE:** Do ONLY the work described in "YOUR TASK" below. Nothing more. If the task implies work for another step (e.g., generating images when your step is writing copy), STOP — that belongs to a different agent.')
  lines.push('2. **OUTPUT:** Submit via bakin_exec_submit_step. Describing results in conversation does NOT complete the step. The workflow will not advance.')
  lines.push('3. **SCHEMA:** Your output MUST match the JSON schema below. The server validates it. Missing fields = rejection. Extra fields = rejection. Wrong types = rejection.')
  lines.push('4. **NO SIDE EFFECTS:** Do not create subtasks, dispatch other agents, move the task to Done, or post to any channel. The workflow engine handles ALL downstream handoffs — the next agent is already defined in the workflow and will be dispatched automatically when your step is approved. Creating a subtask would duplicate the workflow\'s job.')
  lines.push('5. **ONE SUBMISSION:** Submit your output once via the API, then stop. Do not continue working after submission.')
  if (stepContext.deny_tools?.length) {
    lines.push(`6. **TOOL RESTRICTIONS:** Do NOT use: ${stepContext.deny_tools.join(', ')}. If this step requires those capabilities, BLOCK the task immediately.`)
  }
  lines.push('')
  flush('hard-constraints')
  lines.push(...outputDisciplineSection(agentName, task.id, { subtasksAllowed: false }))
  lines.push('')
  flush('output-discipline')

  // ─── Revision Context ───────────────────────────────────────────────
  if (stepContext.rejectionReason) {
    lines.push('## REVISION REQUIRED')
    lines.push('')
    if (stepContext.previousOutput) {
      lines.push('**Previous output (rejected):**')
      lines.push('```json')
      lines.push(JSON.stringify(stepContext.previousOutput, null, 2))
      lines.push('```')
      lines.push('')
    }
    lines.push(`**What to fix:** ${stepContext.rejectionReason}`)
    lines.push('')
    lines.push('You MUST address this specific feedback. Do NOT resubmit unchanged output — the server detects near-duplicate resubmissions and rejects them.')
    lines.push('')
  }
  flush('revision')

  // ─── Workflow Context (all prior step outputs) ─────────────────────
  if (stepContext.stepOutputs && Object.keys(stepContext.stepOutputs).length > 0) {
    lines.push('## WORKFLOW CONTEXT')
    lines.push('')
    lines.push('All completed step outputs from this workflow. Use as context for your work:')
    lines.push('')
    for (const [sid, output] of Object.entries(stepContext.stepOutputs)) {
      const label = sid === '__parentContext' ? 'Parent Workflow (upstream handoff)' : `Step: ${sid}`
      lines.push(`### ${label}`)
      // Surface parent task metadata prominently for child workflows
      if (sid === '__parentContext' && output && typeof output === 'object') {
        const ctx = output as Record<string, unknown>
        if (ctx._parentTaskTitle) {
          lines.push(`**Parent Task:** ${ctx._parentTaskTitle}`)
        }
        if (ctx._parentTaskDescription) {
          lines.push(`**Description:** ${ctx._parentTaskDescription}`)
        }
        // Show remaining output data (excluding internal metadata keys)
        const rest = Object.fromEntries(Object.entries(ctx).filter(([k]) => !k.startsWith('_parent')))
        if (Object.keys(rest).length > 0) {
          lines.push('```json')
          lines.push(JSON.stringify(rest, null, 2))
          lines.push('```')
        }
      } else {
        lines.push('```json')
        lines.push(JSON.stringify(output, null, 2))
        lines.push('```')
      }
      lines.push('')
    }
  } else if (stepContext.priorStepOutput) {
    lines.push('## PRIOR STEP OUTPUT')
    lines.push('')
    lines.push('The previous step in this workflow produced the following output. Use this as context for your work:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.priorStepOutput, null, 2))
    lines.push('```')
    lines.push('')
  }
  flush('workflow-context')

  if (lessonBlock) {
    lines.push(lessonBlock)
    lines.push('')
  }
  flush('lessons')

  if (assetsBlock) {
    lines.push(assetsBlock.trim())
    lines.push('')
  }
  flush('assets')

  // ─── Task Instructions ──────────────────────────────────────────────
  lines.push('## YOUR TASK')
  lines.push('')
  if (stepContext.instructions) {
    lines.push(stepContext.instructions)
    lines.push('')
  }
  flush('task-instructions')

  // ─── Required Output ────────────────────────────────────────────────
  if (stepContext.output_schema) {
    lines.push('## REQUIRED OUTPUT')
    lines.push('')
    lines.push('Your output must be valid JSON matching this schema:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.output_schema, null, 2))
    lines.push('```')
    lines.push('')
  }
  flush('output-schema')

  // ─── Progress Logging ──────────────────────────────────────────────
  lines.push('## PROGRESS LOGGING — MANDATORY')
  lines.push('')
  const { server: wfServer, mc: wfMc } = mcporterHelpers(agentName)

  lines.push('You MUST log your progress throughout this workflow step. These updates appear in the live activity feed so humans can monitor your work in real-time.')
  lines.push('')
  lines.push('**When to log:**')
  lines.push('- IMMEDIATELY when you start working (what you are about to do and your approach)')
  lines.push('- After each significant action (reading files, generating content, making API calls, reviewing output)')
  lines.push('- Share your reasoning ("The brief calls for warm tones, going with golden hour lighting")')
  lines.push('- If anything unexpected happens or you are blocked')
  lines.push('- When you complete and submit your output (summary of what you produced)')
  lines.push('- If more than 2 minutes have passed since your last log, send a status update — even if just "Still working on X, currently Y"')
  lines.push('')
  flush('progress-logging')

  // ─── Commands ───────────────────────────────────────────────────────
  lines.push('## COMMANDS')
  lines.push('')
  lines.push(`Your Bakin MCP server is \`${wfServer}\`. Use mcporter for all interactions:`)
  lines.push('')
  lines.push('```bash')
  lines.push(`# Submit your output (must match the schema above)`)
  lines.push(`${wfMc('bakin_exec_submit_step', `taskId=${task.id} stepId=${stepContext.stepId} --args '<json output>'`)}`)
  lines.push('')
  lines.push(`# Log progress (mandatory, every major step)`)
  lines.push(`${wfMc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}`)
  lines.push('')
  lines.push(`# Check your current step details if needed`)
  lines.push(`${wfMc('bakin_exec_get_step', `taskId=${task.id}`)}`)
  lines.push('')
  lines.push('# --- Execution tools for doing actual work ---')
  lines.push('')
  // Channel posting only for output/publish steps (others have "NO SIDE EFFECTS")
  lines.push(...sharedExecutionToolDocs(agentName, task.id, { allowChannelPost: stepContext.type === 'output' }))
  lines.push('```')
  lines.push('')
  flush('commands')

  // ─── Stop Instruction ───────────────────────────────────────────────
  lines.push('## AFTER SUBMITTING')
  lines.push('')
  lines.push('After bakin_exec_submit_step returns success, your work is done. Do NOT:')
  lines.push('- Generate additional outputs or deliverables')
  lines.push('- Start work on what you think the next step might be')
  lines.push('- Send messages about what should happen next')
  lines.push('- Move the task to Done (the workflow engine handles this)')
  flush('stop')

  return sections
}

/**
 * Build a workflow-step dispatch message.
 * @internal Exported for testing and the context-report diagnostics.
 */
export function buildWorkflowDispatchMessage(
  task: { id: string; title: string; description?: string },
  stepContext: Parameters<typeof buildWorkflowDispatchSections>[1],
  agentName: string,
  lessonBlock = '',
  recovery?: SessionDeathState,
  assetsBlock = '',
): string {
  return buildWorkflowDispatchSections(task, stepContext, agentName, lessonBlock, recovery, assetsBlock)
    .map((s) => s.text)
    .join('\n')
}
