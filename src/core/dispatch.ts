/**
 * Task dispatch system for Beacon.
 * Periodically checks for TODO tasks and dispatches them to agents via OpenClaw.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import * as openclaw from './openclaw-client'
import { readTaskboard, blockTask, addTaskLog as taskLog } from '../../plugins/tasks/taskboard'
import { isStale } from '../lib/format'
import {
  loadInstance,
  createInstance,
  saveInstance,
  getCurrentStep,
  getActiveAgents,
} from '../../plugins/workflows/runtime'

const log = createLogger('dispatch')

const AGENT_ID_MAP: Record<string, string> = { main-operator: 'main' }
const resolveId = (name: string) => AGENT_ID_MAP[name] || name

interface FailureRecord {
  lastAttempt: number
  count: number
}

interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[]
  failedDispatches: Record<string, FailureRecord | number>  // number = legacy format
}

let dispatching = false
let dispatchStartedAt = 0
let dispatchTimer: NodeJS.Timeout | null = null
const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes max per dispatch cycle

// Async mutex for .dispatch-state.json — serializes all reads/writes
let stateQueue = Promise.resolve() as Promise<unknown>
function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = stateQueue.then(fn, fn) as Promise<T>
  stateQueue = next.then(() => {}, () => {})
  return next
}

function getStateFile(contentDir: string): string {
  return join(contentDir, '.dispatch-state.json')
}

function getFailureRecord(entry: FailureRecord | number | undefined): FailureRecord | null {
  if (!entry) return null
  // Migrate legacy format (plain timestamp number)
  if (typeof entry === 'number') return { lastAttempt: entry, count: 1 }
  return entry
}

export function loadDispatchState(contentDir: string): DispatchState {
  const stateFile = getStateFile(contentDir)
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (!Array.isArray(parsed.dispatched)) parsed.dispatched = []
      if (!parsed.failedDispatches || typeof parsed.failedDispatches !== 'object') parsed.failedDispatches = {}
      return parsed
    }
  } catch (err) {
    log.warn('Failed to read dispatch state', err)
  }
  return { lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {} }
}

function saveDispatchState(contentDir: string, state: DispatchState): void {
  writeFileSync(getStateFile(contentDir), JSON.stringify(state, null, 2), 'utf-8')
}

export async function dispatchTasks(contentDir: string, port: number): Promise<void> {
  // If a previous dispatch is stuck (>3min), force-release the mutex
  if (dispatching && dispatchStartedAt > 0 && (Date.now() - dispatchStartedAt) > DISPATCH_TIMEOUT_MS) {
    log.warn('Dispatch mutex stuck — force-releasing after timeout', { stuckSinceMs: Date.now() - dispatchStartedAt })
    dispatching = false
  }
  if (dispatching) return
  dispatching = true
  dispatchStartedAt = Date.now()

  const settings = getSettings()

  try {
    // Acquire state lock for the entire cycle to prevent races with dispatchSingleTask
    await withStateLock(async () => {
    const { getTodoTasks, moveTaskToInProgress, addTaskLog } = await import('../lib/taskboard')

    const { todoTasks } = getTodoTasks()
    const state = loadDispatchState(contentDir)
    const dispatchedSet = new Set(state.dispatched)

    // Reconcile dispatch state with taskboard reality
    const { columns } = readTaskboard()
    const activeIds = new Set([
      ...columns.inProgress.map(t => t.id),
      ...columns.done.map(t => t.id),
      ...columns.confirmed.map(t => t.id),
    ])
    state.dispatched = state.dispatched.filter(id => activeIds.has(id))
    for (const task of columns.inProgress) {
      if (!dispatchedSet.has(task.id)) {
        dispatchedSet.add(task.id)
        state.dispatched.push(task.id)
      }
    }

    // ─── Dispatch in-progress workflow tasks that changed step agents ──
    // After gate approval, the workflow advances to a new agent's step but
    // the task stays in inProgress. We need to dispatch the new agent.
    for (const task of columns.inProgress) {
      const wfTask = task as typeof task & { workflowId?: string }
      if (!wfTask.workflowId) continue

      // Check if the current workflow step agent has been dispatched
      const activeAgents = getActiveAgents(task.id, contentDir)
      const needsDispatch = activeAgents.some(({ stepId }) => !dispatchedSet.has(`${task.id}:${stepId}`))
      if (!needsDispatch) continue

      try {
        await dispatchWorkflowTask(
          { ...wfTask, workflowId: wfTask.workflowId },
          contentDir, port, dispatchedSet, state,
          async () => {}, // already in progress, no column move needed
          addTaskLog
        )
      } catch (err) {
        log.error(`Failed to re-dispatch workflow task "${task.title}"`, err)
      }
    }

    if (todoTasks.length === 0) {
      saveDispatchState(contentDir, state)
      return
    }

    for (const task of todoTasks) {
      if (dispatchedSet.has(task.id)) continue

      // Check failure history with max retries
      const failure = getFailureRecord(state.failedDispatches?.[task.id])
      if (failure) {
        if (failure.count >= settings.dispatch.maxRetries) {
          // Escalate to blocked
          try {
            await blockTask(task.id, `Dispatch failed ${failure.count} times — agent may be unavailable`)
            await addTaskLog(task.id, 'system', `Dispatch exhausted: ${failure.count} failed attempts. Task moved to blocked.`)
            appendAudit(contentDir, 'task.dispatch_exhausted', 'system', { id: task.id, title: task.title, count: failure.count })
            log.warn('Task blocked after max dispatch retries', { id: task.id, count: failure.count })
          } catch (err) {
            log.error('Failed to block exhausted task', err)
          }
          continue
        }
        if (Date.now() - failure.lastAttempt < settings.dispatch.failureCooldownMs) continue
      }

      if (task.agent && !settings.agents.includes(task.agent)) continue

      // Workflow-aware dispatch path
      const taskWithWorkflow = task as typeof task & { workflowId?: string }
      if (taskWithWorkflow.workflowId) {
        try {
          await dispatchWorkflowTask({ ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId }, contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog)
        } catch (err) {
          log.error(`Failed to dispatch workflow task "${task.title}"`, err)
        }
        continue
      }

      const targetAgent = task.agent ? resolveId(task.agent) : 'main'
      const agentName = task.agent || 'main-operator'

      const message = buildDispatchMessage(task, agentName, contentDir, port)

      try {
        // Move to inProgress BEFORE sending message to eliminate race condition
        // where fast agents complete before dispatch moves the task
        await moveTaskToInProgress(task.id, agentName)
        appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

        await openclaw.sendMessage(targetAgent, message)
        dispatchedSet.add(task.id)

        appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title })
        log.info('Task dispatched', { id: task.id, title: task.title, agent: targetAgent })
      } catch (err) {
        log.error(`Failed to dispatch "${task.title}" to ${targetAgent}`, err)

        if (!state.failedDispatches) state.failedDispatches = {}
        const prev = getFailureRecord(state.failedDispatches[task.id])
        state.failedDispatches[task.id] = { lastAttempt: Date.now(), count: (prev?.count || 0) + 1 }

        try {
          await addTaskLog(task.id, 'system', `Dispatch failed (attempt ${(prev?.count || 0) + 1}): agent "${targetAgent}" not found or unavailable`)
        } catch {
          // best effort
        }

        appendAudit(contentDir, 'task.dispatch_failed', targetAgent, { id: task.id, title: task.title, error: String(err), attempt: (prev?.count || 0) + 1 })
      }
    }

    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    if (state.dispatched.length > settings.dispatch.maxDispatched) {
      state.dispatched = state.dispatched.slice(-200)
    }
    saveDispatchState(contentDir, state)
    }) // end withStateLock
  } finally {
    dispatching = false
  }
}

/**
 * Immediately dispatch a single task by ID, bypassing the 5-minute cycle.
 * Used for kick (explicit) and auto-kick (subtask with parentId).
 */
export async function dispatchSingleTask(
  taskId: string,
  contentDir: string,
  port: number,
  source: 'kick' | 'subtask' = 'kick'
): Promise<void> {
  const settings = getSettings()

  await withStateLock(async () => {
    const { columns } = readTaskboard()
    const task = columns.todo.find(t => t.id === taskId)
    if (!task) {
      log.debug('dispatchSingleTask: task not in todo, skipping', { taskId })
      return
    }

    if (task.agent && !settings.agents.includes(task.agent)) {
      log.warn('dispatchSingleTask: agent not in allowed list', { taskId, agent: task.agent })
      return
    }

    const state = loadDispatchState(contentDir)
    if (state.dispatched.includes(taskId)) {
      log.debug('dispatchSingleTask: already dispatched', { taskId })
      return
    }

    // Check failure history
    const failure = getFailureRecord(state.failedDispatches?.[taskId])
    if (failure) {
      if (failure.count >= settings.dispatch.maxRetries) {
        log.warn('dispatchSingleTask: task exhausted retries', { taskId, count: failure.count })
        return
      }
      if (Date.now() - failure.lastAttempt < settings.dispatch.failureCooldownMs) {
        log.debug('dispatchSingleTask: task in cooldown', { taskId })
        return
      }
    }

    const { moveTaskToInProgress, addTaskLog } = await import('../lib/taskboard')

    // Workflow-aware dispatch path
    const taskWithWorkflow = task as typeof task & { workflowId?: string }
    if (taskWithWorkflow.workflowId) {
      const dispatchedSet = new Set(state.dispatched)
      try {
        await dispatchWorkflowTask(
          { ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId },
          contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog,
        )
        state.dispatched = [...dispatchedSet]
        saveDispatchState(contentDir, state)
        appendAudit(contentDir, 'task.kicked', source, { id: taskId, title: task.title, workflow: true })
        log.info('Single-task dispatch (workflow)', { id: taskId, title: task.title, source })
      } catch (err) {
        log.error(`dispatchSingleTask: workflow dispatch failed for "${task.title}"`, err)
      }
      return
    }

    // Regular task dispatch
    const targetAgent = task.agent ? resolveId(task.agent) : 'main'
    const agentName = task.agent || 'main-operator'
    const message = buildDispatchMessage(task, agentName, contentDir, port)

    try {
      // Move to inProgress BEFORE sending message to eliminate race condition
      await moveTaskToInProgress(task.id, agentName)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

      await openclaw.sendMessage(targetAgent, message)

      state.dispatched.push(task.id)
      saveDispatchState(contentDir, state)

      appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title })
      appendAudit(contentDir, 'task.kicked', source, { id: task.id, title: task.title })
      log.info('Single-task dispatch', { id: task.id, title: task.title, agent: targetAgent, source })
    } catch (err) {
      log.error(`dispatchSingleTask: failed to dispatch "${task.title}" to ${targetAgent}`, err)

      if (!state.failedDispatches) state.failedDispatches = {}
      const prev = getFailureRecord(state.failedDispatches[task.id])
      state.failedDispatches[task.id] = { lastAttempt: Date.now(), count: (prev?.count || 0) + 1 }
      saveDispatchState(contentDir, state)

      try {
        await addTaskLog(task.id, 'system', `Immediate dispatch failed (attempt ${(prev?.count || 0) + 1}): agent "${targetAgent}" not found or unavailable`)
      } catch {
        // best effort
      }
    }
  })
}

function buildDispatchMessage(
  task: { id: string; title: string; description?: string; agent?: string },
  agentName: string,
  contentDir: string,
  _port: number
): string {
  const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''
  const contactsRef = `Reference info is in ${join(contentDir, 'team/CONTACTS.md')}.`
  const taskboardRef = join(contentDir, 'TASKBOARD.md')

  const server = `beacon-${agentName}`
  const mc = (tool: string, args: string) => `mcporter call ${server}.${tool} ${args}`

  if (!task.agent) {
    return `Triage this task: "${task.title}".${detailsBlock}\n\nEither handle it yourself or assign it to the right agent (patch=execution, pixel=design/media, rolo=content/comms, chef=research/strategy) by updating ${taskboardRef}. ${contactsRef}\n\nLog progress: \`${mc('beacon_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  if (task.agent === 'main-operator') {
    return `Work on this task: "${task.title}".${detailsBlock}\n\n${contactsRef} When done: \`${mc('beacon_report_complete', `taskId=${task.id} summary="<what you did>"`)}\`\n\nLog progress: \`${mc('beacon_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  return `Work on this task: "${task.title}".${detailsBlock}

## PROGRESS LOGGING — MANDATORY

You MUST log your progress at EVERY major step — not just start and done. These updates appear in the live activity feed so humans can monitor your work in real-time.

Required log points:
- Log at task start: what you are about to do and your approach
- Log after each major step (reading files, planning, each significant code change, after build)
- Share your reasoning and decisions as you go
- Log if blocked or anything unexpected happens
- Log on completion with a full summary
- If you have not logged in the last 2 minutes, log a status update — even if just "still working on X"

For Patch using Claude Code: log before spawning the agent, and after it completes.

## BEACON TOOLS — via mcporter

All Beacon interactions use mcporter. Your server is \`${server}\`.

\`\`\`bash
# Log progress (mandatory, every major step)
${mc('beacon_log_progress', `taskId=${task.id} message="<what you did or are doing>"`)}

# Report complete (when finished — includes summary + notifies orchestrator)
${mc('beacon_report_complete', `taskId=${task.id} summary="<what you accomplished>"`)}

# Block task (if stuck or cannot proceed)
${mc('beacon_block_task', `taskId=${task.id} reason="<what went wrong>"`)}

# Create subtask for another agent
${mc('beacon_create_task', `title="<subtask>" assignee="<agent>" description="<brief>" parentId=${task.id}`)}

# Register dependency (then stop — you'll be re-dispatched)
${mc('beacon_register_dependency', `taskId=${task.id} dependsOn="<other-task-id>"`)}

# Check your task details
${mc('beacon_get_task', `taskId=${task.id}`)}

# Find content directories (assets, team, etc.)
${mc('beacon_get_paths', '')}
\`\`\`

## DEPENDENCY PATTERN

If your task requires output from another agent:
1. Create their task with beacon_create_task (use parentId for immediate dispatch)
2. Register the dependency with beacon_register_dependency
3. Stop — you will be automatically re-dispatched when their task completes`
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()
  dispatchTimer = setInterval(() => {
    dispatchTasks(contentDir, port).catch(err => {
      log.error('Dispatch cycle failed', err)
      appendAudit(contentDir, 'system.dispatch_error', 'system', { error: String(err) })
    })
  }, settings.dispatch.intervalMs)
  log.info('Dispatch started', { intervalMs: settings.dispatch.intervalMs })
}

export function stop(): void {
  if (dispatchTimer) {
    clearInterval(dispatchTimer)
    dispatchTimer = null
    log.info('Dispatch stopped')
  }
}

/**
 * Dispatch a workflow-backed task. Creates an instance if needed,
 * then sends only the current step's instructions to the assigned agent.
 */
async function dispatchWorkflowTask(
  task: { id: string; title: string; description?: string; agent?: string; workflowId: string },
  contentDir: string,
  port: number,
  dispatchedSet: Set<string>,
  state: DispatchState,
  moveTaskToInProgress: (id: string, agent: string) => Promise<void>,
  addTaskLog: (id: string, author: string, message: string) => Promise<void>,
): Promise<void> {
  // Load or create workflow instance.
  // Pass the task assignee so $assigned steps resolve to whoever owns the task at start time.
  let instance = loadInstance(task.id, contentDir)
  if (!instance) {
    instance = createInstance(task.id, task.workflowId, contentDir, task.agent)
    log.info('Created workflow instance', { taskId: task.id, workflowId: task.workflowId, resolvedAgent: task.agent })
  } else if (!instance.resolvedAgent && task.agent) {
    // Backfill resolvedAgent if instance was created before $assigned resolution was wired up
    instance.resolvedAgent = task.agent
    saveInstance(instance, contentDir)
    log.info('Backfilled resolvedAgent on existing instance', { taskId: task.id, resolvedAgent: task.agent })
  }

  // Get agents for current step
  const activeAgents = getActiveAgents(task.id, contentDir)
  if (activeAgents.length === 0) {
    log.debug('No active agents for workflow step', { taskId: task.id })
    return
  }

  // Move task to in_progress BEFORE dispatching to agents — same pattern as
  // non-workflow tasks. Prevents the task from sitting in "todo" while the
  // agent is already working on it.
  if (!dispatchedSet.has(task.id)) {
    const { columns: fresh } = readTaskboard()
    const stillInTodo = fresh.todo.some(t => t.id === task.id)
    if (stillInTodo) {
      const firstAgent = activeAgents[0]?.agent || task.agent || 'main-operator'
      await moveTaskToInProgress(task.id, firstAgent)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })
    }
    dispatchedSet.add(task.id)
  }

  for (const { agent, stepId, effectiveTaskId } of activeAgents) {
    // For nested workflows, use the child's taskId for step context resolution
    const contextTaskId = effectiveTaskId || task.id
    const stepContext = getCurrentStep(contextTaskId, agent, contentDir)
    if (!stepContext || 'status' in stepContext && (stepContext.status === 'complete' || stepContext.status === 'pending_approval')) {
      continue
    }

    const ctx = stepContext as {
      stepId: string; label: string; instructions?: string;
      output_schema?: Record<string, unknown>; rejectionReason?: string;
      previousOutput?: Record<string, unknown>; priorStepOutput?: Record<string, unknown>;
      stepOutputs?: Record<string, Record<string, unknown>>; deny_tools?: string[]
    }
    const targetAgent = resolveId(agent)
    // Pass contextTaskId so the step/complete API targets the right instance
    const message = buildWorkflowDispatchMessage({ ...task, id: contextTaskId }, ctx, agent, port)

    try {
      await openclaw.sendMessage(targetAgent, message)
      dispatchedSet.add(`${task.id}:${stepId}`)

      appendAudit(contentDir, 'task.dispatched', targetAgent, {
        id: task.id,
        title: task.title,
        workflowId: task.workflowId,
        stepId,
      })
      log.info('Workflow step dispatched', { taskId: task.id, stepId, agent: targetAgent })
    } catch (err) {
      log.error(`Failed to dispatch workflow step "${stepId}" to ${targetAgent}`, err)
      if (!state.failedDispatches) state.failedDispatches = {}
      state.failedDispatches[task.id] = Date.now()

      try {
        await addTaskLog(task.id, 'system', `Workflow dispatch failed for step "${stepId}": agent "${targetAgent}" unavailable`)
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Build a dispatch message for a workflow step.
 * Contains ONLY the current step instructions — never future steps.
 *
 * Structure: identity frame → hard constraints → revision context → task → output → commands → stop.
 * Rules come BEFORE instructions (position primacy — LLMs weight early text more).
 */
function buildWorkflowDispatchMessage(
  task: { id: string; title: string; description?: string },
  stepContext: {
    stepId: string
    label: string
    instructions?: string
    output_schema?: Record<string, unknown>
    rejectionReason?: string
    previousOutput?: Record<string, unknown>
    priorStepOutput?: Record<string, unknown>
    stepOutputs?: Record<string, Record<string, unknown>>
    deny_tools?: string[]
  },
  agentName: string,
  _port: number
): string {
  const lines: string[] = []

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

  // ─── Hard Constraints ───────────────────────────────────────────────
  lines.push('## HARD CONSTRAINTS — violations are rejected server-side')
  lines.push('')
  lines.push('1. **SCOPE:** Do ONLY the work described in "YOUR TASK" below. Nothing more. If the task implies work for another step (e.g., generating images when your step is writing copy), STOP — that belongs to a different agent.')
  lines.push('2. **OUTPUT:** Submit via beacon_submit_step. Describing results in conversation does NOT complete the step. The workflow will not advance.')
  lines.push('3. **SCHEMA:** Your output MUST match the JSON schema below. The server validates it. Missing fields = rejection. Extra fields = rejection. Wrong types = rejection.')
  lines.push('4. **NO SIDE EFFECTS:** Do not create subtasks, dispatch other agents, move the task to Done, or post to any channel. The workflow engine handles ALL downstream handoffs — the next agent is already defined in the workflow and will be dispatched automatically when your step is approved. Creating a subtask would duplicate the workflow\'s job.')
  lines.push('5. **ONE SUBMISSION:** Submit your output once via the API, then stop. Do not continue working after submission.')
  if (stepContext.deny_tools?.length) {
    lines.push(`6. **TOOL RESTRICTIONS:** Do NOT use: ${stepContext.deny_tools.join(', ')}. If this step requires those capabilities, BLOCK the task immediately.`)
  }
  lines.push('')

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

  // ─── Task Instructions ──────────────────────────────────────────────
  lines.push('## YOUR TASK')
  lines.push('')
  if (stepContext.instructions) {
    lines.push(stepContext.instructions)
    lines.push('')
  }

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

  // ─── Progress Logging ──────────────────────────────────────────────
  lines.push('## PROGRESS LOGGING — MANDATORY')
  lines.push('')
  const wfServer = `beacon-${agentName}`
  const wfMc = (tool: string, args: string) => `mcporter call ${wfServer}.${tool} ${args}`

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

  // ─── Commands ───────────────────────────────────────────────────────
  lines.push('## COMMANDS')
  lines.push('')
  lines.push(`Your Beacon MCP server is \`${wfServer}\`. Use mcporter for all interactions:`)
  lines.push('')
  lines.push('```bash')
  lines.push(`# Submit your output (must match the schema above)`)
  lines.push(`${wfMc('beacon_submit_step', `taskId=${task.id} stepId=${stepContext.stepId} --args '<json output>'`)}`)
  lines.push('')
  lines.push(`# Log progress (mandatory, every major step)`)
  lines.push(`${wfMc('beacon_log_progress', `taskId=${task.id} message="<update>"`)}`)
  lines.push('')
  lines.push(`# Check your current step details if needed`)
  lines.push(`${wfMc('beacon_get_step', `taskId=${task.id}`)}`)
  lines.push('```')
  lines.push('')

  // ─── Stop Instruction ───────────────────────────────────────────────
  lines.push('## AFTER SUBMITTING')
  lines.push('')
  lines.push('After beacon_submit_step returns success, your work is done. Do NOT:')
  lines.push('- Generate additional outputs or deliverables')
  lines.push('- Start work on what you think the next step might be')
  lines.push('- Send messages about what should happen next')
  lines.push('- Move the task to Done (the workflow engine handles this)')

  return lines.join('\n')
}

/**
 * Run once on server startup to recover orphaned in-progress tasks.
 * If an agent's heartbeat is stale and the task has no recent logs, move back to todo.
 */
export async function reconcileOnStartup(contentDir: string): Promise<void> {
  const settings = getSettings()
  try {
    const { columns } = readTaskboard()
    let recovered = 0

    for (const task of [...columns.inProgress]) {
      const agentStale = isAgentHeartbeatStale(contentDir, task.agent)
      const hasRecentLog = task.log?.some(e => {
        const ts = new Date(e.timestamp).getTime()
        return !isNaN(ts) && (Date.now() - ts) < settings.watchdog.stuckThresholdMs
      })

      if (agentStale && !hasRecentLog) {
        try {
          await taskLog(task.id, 'system', 'Recovered on server restart: agent heartbeat stale and no recent task logs.')
          const { moveTask: doMove } = await import('../lib/taskboard')
          await doMove(task.id, 'todo')
          appendAudit(contentDir, 'task.startup_recovered', 'system', { id: task.id, title: task.title, agent: task.agent })
          recovered++
          log.info('Startup recovery: task moved to todo', { id: task.id, title: task.title })
        } catch (err) {
          log.error('Startup recovery failed for task', err, { id: task.id })
        }
      }
    }

    if (recovered > 0) {
      log.info('Startup reconciliation complete', { recovered })
    }
  } catch (err) {
    log.error('Startup reconciliation failed', err)
  }
}

function isAgentHeartbeatStale(contentDir: string, agent: string | undefined): boolean {
  if (!agent) return true
  const heartbeatPath = join(contentDir, 'heartbeats', `${agent}.json`)
  try {
    if (!existsSync(heartbeatPath)) return true
    const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8'))
    const ts = data.timestamp || data.ts
    if (!ts) return true
    return isStale(ts, 15 * 60 * 1000)
  } catch {
    return true
  }
}

export function getDispatchInfo(contentDir: string): Record<string, unknown> {
  const settings = getSettings()
  const state = loadDispatchState(contentDir)
  const now = Date.now()
  const interval = settings.dispatch.intervalMs
  const baseline = state.lastRun || state.serverStart || now

  // Calculate the next run time that's actually in the future.
  // If we've missed one or more intervals (e.g. dispatch was stuck),
  // advance to the next upcoming tick rather than showing 0:00.
  let nextRun = baseline + interval
  if (nextRun <= now) {
    const elapsed = now - baseline
    const missedIntervals = Math.floor(elapsed / interval)
    nextRun = baseline + (missedIntervals + 1) * interval
  }
  const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))

  return {
    intervalMs: interval,
    intervalMin: interval / 60000,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    nextRun: new Date(nextRun).toISOString(),
    secondsUntilNext,
    dispatching,
    dispatchedCount: state.dispatched.length,
  }
}
