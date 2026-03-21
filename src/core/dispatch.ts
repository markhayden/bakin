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
import {
  loadInstance,
  createInstance,
  getCurrentStep,
  getActiveAgents,
} from '../../plugins/workflows/runtime'

const log = createLogger('dispatch')

const AGENT_ID_MAP: Record<string, string> = { roscoe: 'main' }
const resolveId = (name: string) => AGENT_ID_MAP[name] || name

interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[]
  failedDispatches: Record<string, number>
}

let dispatching = false
let dispatchTimer: NodeJS.Timeout | null = null

function getStateFile(contentDir: string): string {
  return join(contentDir, '.dispatch-state.json')
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
  if (dispatching) return
  dispatching = true

  const settings = getSettings()

  try {
    const { getTodoTasks, moveTaskToInProgress, addTaskLog } = await import('../lib/taskboard')

    const { todoTasks } = getTodoTasks()
    if (todoTasks.length === 0) return

    const state = loadDispatchState(contentDir)
    const dispatchedSet = new Set(state.dispatched)

    for (const task of todoTasks) {
      if (dispatchedSet.has(task.id)) continue

      const lastFailure = state.failedDispatches?.[task.id]
      if (lastFailure && Date.now() - lastFailure < settings.dispatch.failureCooldownMs) continue

      if (task.agent && !settings.agents.includes(task.agent)) continue

      // Workflow-aware dispatch path
      const taskWithWorkflow = task as typeof task & { workflowId?: string }
      if (taskWithWorkflow.workflowId) {
        try {
          await dispatchWorkflowTask(taskWithWorkflow, contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog)
        } catch (err) {
          log.error(`Failed to dispatch workflow task "${task.title}"`, err)
        }
        continue
      }

      const targetAgent = task.agent ? resolveId(task.agent) : 'main'
      const agentName = task.agent || 'roscoe'

      const message = buildDispatchMessage(task, agentName, contentDir, port)

      try {
        await openclaw.sendMessage(targetAgent, message)
        await moveTaskToInProgress(task.id, agentName)
        dispatchedSet.add(task.id)

        appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title })
        log.info('Task dispatched', { id: task.id, title: task.title, agent: targetAgent })
      } catch (err) {
        log.error(`Failed to dispatch "${task.title}" to ${targetAgent}`, err)

        if (!state.failedDispatches) state.failedDispatches = {}
        state.failedDispatches[task.id] = Date.now()

        try {
          await addTaskLog(task.id, 'system', `Dispatch failed: agent "${targetAgent}" not found or unavailable`)
        } catch {
          // best effort
        }

        appendAudit(contentDir, 'task.dispatch_failed', targetAgent, { id: task.id, title: task.title, error: String(err) })
      }
    }

    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    if (state.dispatched.length > settings.dispatch.maxDispatched) {
      state.dispatched = state.dispatched.slice(-200)
    }
    saveDispatchState(contentDir, state)
  } finally {
    dispatching = false
  }
}

function buildDispatchMessage(
  task: { id: string; title: string; description?: string; agent?: string },
  agentName: string,
  contentDir: string,
  port: number
): string {
  const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''
  const contactsRef = `Reference info is in ${join(contentDir, 'team/CONTACTS.md')}.`
  const taskboardRef = join(contentDir, 'TASKBOARD.md')
  const logEndpoint = `http://localhost:${port}/api/tasks/log`
  const failureInstructions = `If you cannot complete this task or hit an error, report via: openclaw agent --agent main --message "TASK BLOCKED: ${task.title} — <reason>" --deliver`

  if (!task.agent) {
    return `Triage this task: "${task.title}".${detailsBlock}\n\nEither handle it yourself or assign it to the right agent (patch=execution, pixel=design/media, rolo=content/comms, basil=research/strategy) by updating ${taskboardRef}. ${contactsRef}\n\nLog progress by POSTing to ${logEndpoint} with {"title":"${task.title}","author":"roscoe","message":"your update"}`
  }

  if (task.agent === 'roscoe') {
    return `Work on this task: "${task.title}".${detailsBlock}\n\n${contactsRef} When done, move it to the Done column in ${taskboardRef} and log what you did.\n\nLog progress by POSTing to ${logEndpoint} with {"title":"${task.title}","author":"roscoe","message":"your update"}\n\n${failureInstructions}`
  }

  return `Work on this task: "${task.title}".${detailsBlock}\n\nLog your progress at EVERY major step — not just start and done. Required log points:\n- Log at task start: what you are about to do\n- Log after each major step (reading files, planning, each significant code change, after build)\n- Log if blocked or anything unexpected happens\n- Log on completion with a full summary\n- If you have not logged in the last 5 minutes, log a status update — even if just "still working on X"\n\nFor Patch using Claude Code: log before spawning the agent, and after it completes.\n\nLog command: POST to ${logEndpoint} with {"title":"${task.id}","author":"${agentName}","message":"your update"}\n\nIf this task requires assets from another agent (e.g. images from Pixel, video from Rolo), create a subtask for them using: curl -s -X POST http://localhost:${port}/api/tasks/create -H 'Content-Type: application/json' -d '{"title":"<subtask title>","assignee":"<agent>","description":"<brief>"}'\n\nWhen finished, move this task to Done: curl -s -X POST http://localhost:${port}/api/tasks/move -H 'Content-Type: application/json' -d '{"id":"${task.id}","to":"done"}'\n\nThen report back to roscoe: openclaw agent --agent main --message "TASK COMPLETE: ${task.title} — <summary>" --deliver\n\n${failureInstructions}\n\nDependency pattern: If your task requires output from another agent, create their task first, note its ID, then register a dependency: curl -s -X POST http://localhost:${port}/api/tasks/depend -H 'Content-Type: application/json' -d '{"id":"${task.id}","dependsOn":"<their-task-id>"}'. Then exit — you will be automatically re-dispatched when their task completes.`
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
  // Load or create workflow instance
  let instance = loadInstance(task.id, contentDir)
  if (!instance) {
    instance = createInstance(task.id, task.workflowId, contentDir)
    log.info('Created workflow instance', { taskId: task.id, workflowId: task.workflowId })
  }

  // Get agents for current step
  const activeAgents = getActiveAgents(task.id, contentDir)
  if (activeAgents.length === 0) {
    log.debug('No active agents for workflow step', { taskId: task.id })
    return
  }

  for (const { agent, stepId } of activeAgents) {
    const stepContext = getCurrentStep(task.id, agent, contentDir)
    if (!stepContext || 'status' in stepContext && (stepContext.status === 'complete' || stepContext.status === 'pending_approval')) {
      continue
    }

    const ctx = stepContext as { stepId: string; label: string; instructions?: string; output_schema?: Record<string, unknown>; rejectionReason?: string }
    const targetAgent = resolveId(agent)
    const message = buildWorkflowDispatchMessage(task, ctx, agent, port)

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

  // Move task to in_progress on first dispatch
  if (!dispatchedSet.has(task.id)) {
    const firstAgent = activeAgents[0]?.agent || task.agent || 'roscoe'
    await moveTaskToInProgress(task.id, firstAgent)
    dispatchedSet.add(task.id)
  }
}

/**
 * Build a dispatch message for a workflow step.
 * Contains ONLY the current step instructions — never future steps.
 */
function buildWorkflowDispatchMessage(
  task: { id: string; title: string },
  stepContext: { stepId: string; label: string; instructions?: string; output_schema?: Record<string, unknown>; rejectionReason?: string },
  agentName: string,
  port: number
): string {
  const lines: string[] = []

  lines.push(`# Workflow Task: "${task.title}"`)
  lines.push(`## Current Step: ${stepContext.label}`)
  lines.push('')

  if (stepContext.rejectionReason) {
    lines.push(`> **REVISION REQUESTED:** ${stepContext.rejectionReason}`)
    lines.push('')
  }

  if (stepContext.instructions) {
    lines.push(stepContext.instructions)
    lines.push('')
  }

  // Workflow framing rules
  lines.push('---')
  lines.push('## Workflow Rules')
  lines.push('- You are working on ONE step of a multi-step workflow')
  lines.push('- Complete this step, then submit your output — the next step will be assigned automatically')
  lines.push('- Do NOT attempt to do work beyond this step')
  lines.push('')

  // API endpoints
  const base = `http://localhost:${port}/api/plugins/workflows`
  lines.push('## Commands')
  lines.push(`Check current step: curl -s "${base}/step?taskId=${task.id}&agentId=${agentName}"`)
  lines.push('')

  if (stepContext.output_schema) {
    lines.push(`Submit output: curl -s -X POST ${base}/step/complete -H 'Content-Type: application/json' -d '${JSON.stringify({ taskId: task.id, stepId: stepContext.stepId, output: '{{YOUR_OUTPUT}}' })}'`)
    lines.push('')
    lines.push('Expected output format:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.output_schema, null, 2))
    lines.push('```')
  } else {
    lines.push(`Submit output: curl -s -X POST ${base}/step/complete -H 'Content-Type: application/json' -d '{"taskId":"${task.id}","stepId":"${stepContext.stepId}","output":{"result":"your output here"}}'`)
  }

  lines.push('')
  lines.push(`Log progress: curl -s -X POST http://localhost:${port}/api/tasks/log -H 'Content-Type: application/json' -d '{"title":"${task.id}","author":"${agentName}","message":"your update"}'`)

  return lines.join('\n')
}

export function getDispatchInfo(contentDir: string): Record<string, unknown> {
  const settings = getSettings()
  const state = loadDispatchState(contentDir)
  const now = Date.now()
  const baseline = state.lastRun || state.serverStart || now
  const nextRun = baseline + settings.dispatch.intervalMs
  const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))

  return {
    intervalMs: settings.dispatch.intervalMs,
    intervalMin: settings.dispatch.intervalMs / 60000,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    nextRun: new Date(nextRun).toISOString(),
    secondsUntilNext,
    dispatchedCount: state.dispatched.length,
  }
}
