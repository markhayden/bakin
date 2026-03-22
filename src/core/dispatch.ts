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
  getCurrentStep,
  getActiveAgents,
} from '../../plugins/workflows/runtime'

const log = createLogger('dispatch')

const AGENT_ID_MAP: Record<string, string> = { roscoe: 'main' }
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

  return `Work on this task: "${task.title}".${detailsBlock}\n\nFIRST: Move this task to In Progress before doing anything else:\ncurl -s -X POST http://localhost:${port}/api/plugins/tasks/move -H 'Content-Type: application/json' -d '{"id":"${task.id}","to":"inProgress","agent":"${agentName}"}'\n\nLog your progress at EVERY major step — not just start and done. Required log points:\n- Log at task start: what you are about to do\n- Log after each major step (reading files, planning, each significant code change, after build)\n- Log if blocked or anything unexpected happens\n- Log on completion with a full summary\n- If you have not logged in the last 5 minutes, log a status update — even if just "still working on X"\n\nFor Patch using Claude Code: log before spawning the agent, and after it completes.\n\nLog command: POST to ${logEndpoint} with {"title":"${task.id}","author":"${agentName}","message":"your update"}\n\nIf this task requires assets from another agent (e.g. images from Pixel, video from Rolo), create a subtask for them using: curl -s -X POST http://localhost:${port}/api/tasks/create -H 'Content-Type: application/json' -d '{"title":"<subtask title>","assignee":"<agent>","description":"<brief>"}'\n\nWhen finished, move this task to Done: curl -s -X POST http://localhost:${port}/api/tasks/move -H 'Content-Type: application/json' -d '{"id":"${task.id}","to":"done","agent":"${agentName}"}'\n\nThen report back to roscoe: openclaw agent --agent main --message "TASK COMPLETE: ${task.title} — <summary>" --deliver\n\n${failureInstructions}\n\nDependency pattern: If your task requires output from another agent, create their task first, note its ID, then register a dependency: curl -s -X POST http://localhost:${port}/api/tasks/depend -H 'Content-Type: application/json' -d '{"id":"${task.id}","dependsOn":"<their-task-id>"}'. Then exit — you will be automatically re-dispatched when their task completes.`
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
