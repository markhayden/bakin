/**
 * Task service layer for Beacon.
 *
 * Shared functions that both REST route handlers and MCP tool handlers call.
 * Each function wraps core taskboard mutations with their required side effects:
 * SSE broadcast, audit logging, continuation triggers, Antfly indexing, etc.
 *
 * This prevents logic duplication and drift between the REST and MCP paths.
 */
import { getContentDir } from './content-dir'
import { appendAudit } from './audit'
import { createLogger } from './logger'
import { indexCompletedTask } from './antfly'
import { checkAndContinueDependents } from './continuation'
import * as openclaw from './openclaw-client'
import {
  addTaskLog,
  blockTask,
  createTask,
  moveTask,
  readTaskboard,
  setDependency,
} from '../../plugins/tasks/taskboard'
import { createInstance, loadInstance } from '../../plugins/workflows/runtime'
import { matchWorkflow } from '../../plugins/workflows/matcher'
import { updateTask } from '../../plugins/tasks/taskboard'

const log = createLogger('task-service')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function broadcast(data: Record<string, unknown>): void {
  const fn = (globalThis as any).__beaconBroadcast
  if (fn) fn(data)
}

function resolveTitle(id: string): string {
  try {
    const { columns } = readTaskboard()
    for (const col of Object.values(columns)) {
      const found = (col as Array<{ id: string; title: string }>).find(t => t.id === id)
      if (found) return found.title
    }
  } catch { /* best effort */ }
  return id
}

function getPort(): number {
  return Number(process.env.PORT || 3737)
}

// ---------------------------------------------------------------------------
// Channel type — tracks whether a call originated from MCP, REST, CLI, etc.
// ---------------------------------------------------------------------------

export type Channel = 'mcp' | 'rest' | 'cli' | 'system'

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Log a progress message for a task.
 * Broadcasts to SSE immediately, then persists to taskboard.
 */
export async function logProgress(
  taskId: string,
  agent: string,
  message: string,
  channel?: Channel,
): Promise<void> {
  // Broadcast to live activity feed first (never block on persistence)
  broadcast({ type: 'activity', agent, message, ts: new Date().toISOString(), taskId, ...(channel ? { channel } : {}) })
  await addTaskLog(taskId, agent, message)
}

/**
 * Move a task between columns with all side effects.
 * Includes: audit, workflow done-guard, continuation trigger, Antfly indexing.
 */
export async function moveTaskWithEffects(
  taskId: string,
  to: string,
  agent: string,
  opts?: { from?: string; skipDoneGuard?: boolean; channel?: Channel },
): Promise<void> {
  // Workflow done-guard: workflow tasks can only reach Done via the workflow engine
  if (to.toLowerCase() === 'done' && !opts?.skipDoneGuard) {
    const { columns } = readTaskboard()
    for (const col of Object.values(columns)) {
      const task = (col as Array<{ id: string; workflowId?: string }>).find(t => t.id === taskId)
      if (task?.workflowId) {
        const instance = loadInstance(task.id)
        if (instance && instance.status !== 'complete') {
          throw new Error('Workflow tasks cannot be moved to Done directly. Use beacon_submit_step — the workflow engine manages task completion.')
        }
        break
      }
    }
  }

  await moveTask(taskId, to, opts?.from)

  const title = resolveTitle(taskId)
  appendAudit(getContentDir(), 'task.moved', agent, { id: taskId, title, from: opts?.from, to }, opts?.channel)

  // Side effects when moved to done
  if (to.toLowerCase() === 'done') {
    indexCompletedTask({ id: taskId, title }).catch(() => {})
    checkAndContinueDependents(taskId, title, getContentDir(), getPort()).catch((err) => {
      log.error('Continuation trigger failed', err)
    })
  }
}

/**
 * Block a task with a reason.
 */
export async function blockTaskWithEffects(
  taskId: string,
  reason: string,
  agent: string,
  channel?: Channel,
): Promise<void> {
  await blockTask(taskId, reason, agent)
  const title = resolveTitle(taskId)
  appendAudit(getContentDir(), 'task.blocked', agent, { id: taskId, title, reason }, channel)
}

/**
 * Create a task with audit logging.
 * Returns the created task.
 */
export async function createTaskWithEffects(opts: {
  title: string
  column?: string
  assignee?: string
  description?: string
  workflowId?: string
  skipWorkflowReason?: string
  createdBy?: string
  parentId?: string
  channel?: Channel
}): Promise<{ id: string; workflowId?: string; suggestedWorkflow?: string }> {
  // Auto-match workflow if none was explicitly provided
  const suggested = !opts.workflowId ? (matchWorkflow(opts.title, opts.description) || undefined) : undefined
  const effectiveWorkflowId = opts.workflowId || undefined

  const task = await createTask(
    opts.title,
    opts.column,
    opts.assignee,
    opts.description,
    effectiveWorkflowId,
    opts.createdBy,
    undefined, // id — let it auto-generate
    opts.parentId,
  )

  // Start workflow instance if one was specified
  if (effectiveWorkflowId) {
    try {
      const contentDir = getContentDir()
      createInstance(task.id, effectiveWorkflowId, contentDir, opts.assignee)
      log.info('Started workflow', { taskId: task.id, workflowId: effectiveWorkflowId })
      broadcast({ type: 'workflow_started', taskId: task.id, workflowId: effectiveWorkflowId })
    } catch (err) {
      log.error('Failed to start workflow', { taskId: task.id, workflowId: effectiveWorkflowId, error: (err as Error).message })
      await updateTask(task.id, { workflowId: undefined })
    }
  }

  appendAudit(getContentDir(), 'task.created', opts.createdBy || 'system', {
    id: task.id,
    title: opts.title,
    assignee: opts.assignee,
    workflowId: effectiveWorkflowId,
    skipWorkflowReason: opts.skipWorkflowReason,
    suggestedWorkflow: suggested,
  }, opts.channel)
  return { id: task.id, workflowId: effectiveWorkflowId, suggestedWorkflow: suggested }
}

/**
 * Report a task as complete.
 * Rejects workflow tasks (they must use beacon_submit_step).
 * Moves to done, logs summary, notifies orchestrator.
 */
export async function reportComplete(
  taskId: string,
  agent: string,
  summary: string,
  channel?: Channel,
): Promise<void> {
  // Reject workflow tasks
  const { columns } = readTaskboard()
  for (const col of Object.values(columns)) {
    const task = (col as Array<{ id: string; workflowId?: string }>).find(t => t.id === taskId)
    if (task?.workflowId) {
      const instance = loadInstance(task.id)
      if (instance && instance.status !== 'complete') {
        throw new Error('This is a workflow task — use beacon_submit_step to submit your step output instead of beacon_report_complete.')
      }
      break
    }
  }

  await addTaskLog(taskId, agent, `Task complete: ${summary}`)
  await moveTaskWithEffects(taskId, 'done', agent, { skipDoneGuard: true, channel })

  // Notify orchestrator
  const title = resolveTitle(taskId)
  try {
    await openclaw.sendMessage('main', `TASK COMPLETE: ${title} — ${summary}`)
  } catch (err) {
    log.warn('Failed to notify orchestrator of task completion', err)
  }
}

/**
 * Register a dependency between tasks.
 */
export async function setDependencyWithEffects(
  taskId: string,
  dependsOn: string,
  channel?: Channel,
): Promise<void> {
  await setDependency(taskId, dependsOn)
  appendAudit(getContentDir(), 'task.dependency_set', 'api', { id: taskId, dependsOn }, channel)
}

/**
 * Get task details by ID.
 * Returns the task object or null if not found.
 */
export function getTaskDetails(taskId: string): {
  task: Record<string, unknown>
  column: string
} | null {
  const { columns } = readTaskboard()
  for (const [colName, tasks] of Object.entries(columns)) {
    const task = (tasks as Array<{ id: string } & Record<string, unknown>>).find(t => t.id === taskId)
    if (task) {
      return { task: task as Record<string, unknown>, column: colName }
    }
  }
  return null
}

/**
 * Trigger the dispatch cycle. Fire-and-forget.
 */
export function triggerDispatch(): void {
  const port = getPort()
  fetch(`http://localhost:${port}/api/dispatch`, { method: 'POST' }).catch(() => {})
}
