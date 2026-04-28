/**
 * Task service layer for Bakin.
 *
 * Shared functions that both REST route handlers and MCP tool handlers call.
 * Each function wraps core task mutations with their required side effects:
 * SSE broadcast, audit logging, continuation triggers, search indexing, etc.
 *
 * This prevents logic duplication and drift between the REST and MCP paths.
 */
import { getContentDir } from './content-dir'
import { appendAudit } from './audit'
import { createLogger } from './logger'
import { recordUsage } from './usage'
// indexCompletedTask removed — tasks plugin now handles indexing via ctx.search
import { checkAndContinueDependents } from './continuation'
import { getAppServices } from './app-services'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { getHookRegistry } from '../lib/plugin-registry'
import {
  addTaskLog as appendTaskLog,
  blockTask as blockStoredTask,
  createTask as createStoredTask,
  getTaskWithColumn,
  moveTask as moveStoredTask,
  readTaskboard,
  setDependency as setStoredDependency,
  type Task as StoredTask,
  updateTask as updateStoredTask,
} from './task-store'

const log = createLogger('task-service')
const hooks = () => getHookRegistry()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function broadcast(data: Record<string, unknown>): void {
  const fn = (globalThis as { __bakinBroadcast?: (data: Record<string, unknown>) => void }).__bakinBroadcast
  if (fn) fn(data)
}

async function resolveTitle(id: string): Promise<string> {
  try {
    const board = readTaskboard()
    for (const col of Object.values(board.columns) as StoredTask[][]) {
      const found = col.find(t => t.id === id)
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

export type Channel = 'human' | 'mcp' | 'rest' | 'cli' | 'system'

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Log a progress message for a task.
 * Broadcasts to SSE immediately, then persists to task log.
 */
export async function logProgress(
  taskId: string,
  agent: string,
  message: string,
  channel?: Channel,
): Promise<void> {
  // Broadcast to live activity feed first (never block on persistence)
  broadcast({ type: 'activity', agent, message, ts: new Date().toISOString(), taskId, ...(channel ? { channel } : {}) })
  await appendTaskLog(taskId, agent, message)
}

/**
 * Move a task between columns with all side effects.
 * Includes: audit, workflow done-guard, continuation trigger, search indexing.
 */
export async function moveTaskWithEffects(
  taskId: string,
  to: string,
  agent: string,
  opts?: { from?: string; skipDoneGuard?: boolean; channel?: Channel },
): Promise<void> {
  // Workflow done-guard: workflow tasks can only reach Done via the workflow engine
  // Human channel bypasses this guard — the operator can force any state
  if (to.toLowerCase() === 'done' && !opts?.skipDoneGuard && opts?.channel !== 'human') {
    const board = readTaskboard()
    for (const col of Object.values(board.columns) as StoredTask[][]) {
      const task = col.find(t => t.id === taskId)
      if (task?.workflowId) {
        const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
        if (instance && instance.status !== 'complete') {
          throw new Error('Workflow tasks cannot be moved to Done directly. Use bakin_exec_submit_step — the workflow engine manages task completion.')
        }
        break
      }
    }
  }

  await moveStoredTask(taskId, to, opts?.from, opts?.channel)

  const title = await resolveTitle(taskId)
  appendAudit(getContentDir(), 'task.moved', agent, { id: taskId, title, from: opts?.from, to }, opts?.channel)
  recordUsage({
    kind: 'agent',
    name: `task.${to.toLowerCase()}`,
    agent,
    durationMs: null,
    status: 'ok',
    meta: { taskId, previousStatus: opts?.from, title },
  })

  // Side effects when moved to done
  if (to.toLowerCase() === 'done') {
    // Search indexing handled by tasks plugin via ctx.search
    checkAndContinueDependents(taskId, title, getContentDir()).catch((err) => {
      log.error('Continuation trigger failed', err)
    })
    // Purge clipboard-source assets if the setting is enabled
    hooks().invoke('assets.purgeClipboardForTask', { taskId }).catch(() => {})
  }

  // Auto-check project checklist items when task reaches done or archived
  if (to.toLowerCase() === 'done' || to.toLowerCase() === 'archived') {
    hooks().invoke<void>('projects.autoCheckLinkedItem', { taskId }).catch(() => {})
  }

  // Auto-unblock parent when a child workflow task moves out of blocked
  const toLower = to.toLowerCase()
  if (toLower !== 'blocked') {
    const dashIdx = taskId.indexOf('--')
    if (dashIdx > 0) {
      const fromLower = opts?.from?.toLowerCase()
      if (fromLower === 'blocked') {
        const parentTaskId = taskId.slice(0, dashIdx)
        try {
          const board2 = readTaskboard()
          const parentBlocked = (board2?.columns.blocked || [])
            .find(t => t.id === parentTaskId)
          if (parentBlocked?.blockedReason?.startsWith('Child workflow blocked:')) {
            await moveStoredTask(parentTaskId, 'todo', 'blocked')
            const parentTitle = await resolveTitle(parentTaskId)
            appendAudit(getContentDir(), 'task.moved', 'system', {
              id: parentTaskId, title: parentTitle, from: 'blocked', to: 'todo',
              reason: 'Auto-unblocked: child task unblocked',
            }, opts?.channel)
            log.info('Parent task auto-unblocked', { parentTaskId, childTaskId: taskId })
          }
        } catch (err) {
          log.debug('Could not auto-unblock parent', { parentTaskId, err: err instanceof Error ? err.message : String(err) })
        }
      }
    }
  }
}

/**
 * Block a task with a reason.
 * If the task is a child workflow task (id contains '--'), also blocks the
 * parent task so the whole pipeline stops and the user sees it on the board.
 */
export async function blockTaskWithEffects(
  taskId: string,
  reason: string,
  agent: string,
  channel?: Channel,
): Promise<void> {
  await blockStoredTask(taskId, reason, agent)
  const title = await resolveTitle(taskId)
  const contentDir = getContentDir()
  appendAudit(contentDir, 'task.blocked', agent, { id: taskId, title, reason }, channel)
  recordUsage({
    kind: 'agent',
    name: 'task.blocked',
    agent,
    durationMs: null,
    status: 'ok',
    meta: { taskId, title, reason },
  })

  // Propagate block to parent task for child workflow tasks (e.g., "parentId--stepId")
  const dashIdx = taskId.indexOf('--')
  if (dashIdx > 0) {
    const parentTaskId = taskId.slice(0, dashIdx)
    const parentTitle = await resolveTitle(parentTaskId)
    const childReason = `Child workflow blocked: ${reason}`
    try {
      await blockStoredTask(parentTaskId, childReason, 'system')
      appendAudit(contentDir, 'task.blocked', 'system', { id: parentTaskId, title: parentTitle, reason: childReason, blockedBy: taskId }, channel)
      log.info('Parent task blocked due to child', { parentTaskId, childTaskId: taskId })
    } catch (err) {
      // Parent may already be blocked or in a state that can't transition — that's fine
      log.debug('Could not propagate block to parent', { parentTaskId, err: err instanceof Error ? err.message : String(err) })
    }
  }
}

/**
 * Create a task with audit logging.
 * Returns the created task.
 */
export async function createTaskWithEffects(opts: {
  id?: string
  title: string
  column?: string
  assignee?: string
  description?: string
  workflowId?: string
  skipWorkflowReason?: string
  createdBy?: string
  parentId?: string
  projectId?: string
  channel?: Channel
}): Promise<{ id: string; workflowId?: string; suggestedWorkflow?: string }> {
  // Auto-match workflow if none was explicitly provided
  const suggested = !opts.workflowId ? (await hooks().invoke<string | null>('workflows.matchWorkflow', { title: opts.title, description: opts.description }) || undefined) : undefined
  const effectiveWorkflowId = opts.workflowId || undefined

  // Validate that the workflow actually exists BEFORE writing any task row.
  // Without this, agents (or buggy callers) can create tasks pointing at
  // bogus workflowIds, which then poison the dispatch loop forever.
  if (effectiveWorkflowId) {
    const def = await hooks().invoke<Record<string, unknown> | null>('workflows.loadDefinition', { name: effectiveWorkflowId })
    if (!def) {
      const available = await hooks().invoke<Array<{ name: string }>>('workflows.listDefinitions', {}) ?? []
      const names = available.map(d => d.name).sort().join(', ') || '(none)'
      throw new Error(
        `Unknown workflow: "${effectiveWorkflowId}". Available workflows: ${names}. ` +
        `Use bakin_exec_workflows_list to see all options.`
      )
    }
  }

  const task = await createStoredTask(
    opts.title,
    opts.column,
    opts.assignee,
    opts.description,
    effectiveWorkflowId,
    opts.createdBy,
    opts.id,
    opts.parentId,
    opts.projectId,
  )

  // Start workflow instance if one was specified
  if (effectiveWorkflowId) {
    try {
      await hooks().invoke<void>('workflows.createInstance', { taskId: task.id, workflowId: effectiveWorkflowId, assignee: opts.assignee })
      log.info('Started workflow', { taskId: task.id, workflowId: effectiveWorkflowId })
      broadcast({ type: 'workflow_started', taskId: task.id, workflowId: effectiveWorkflowId })
    } catch (err) {
      log.error('Failed to start workflow', { taskId: task.id, workflowId: effectiveWorkflowId, error: (err as Error).message })
      await updateStoredTask(task.id, { workflowId: undefined })
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
  recordUsage({
    kind: 'agent',
    name: 'task.created',
    agent: opts.createdBy || 'system',
    durationMs: null,
    status: 'ok',
    meta: { taskId: task.id, title: opts.title, assignee: opts.assignee, workflowId: effectiveWorkflowId },
  })
  return { id: task.id, workflowId: effectiveWorkflowId, suggestedWorkflow: suggested }
}

/**
 * Report a task as complete.
 * Rejects workflow tasks (they must use bakin_exec_submit_step).
 * Moves to done, logs summary, notifies orchestrator.
 */
export async function reportComplete(
  taskId: string,
  agent: string,
  summary: string,
  channel?: Channel,
): Promise<void> {
  // Reject workflow tasks
  const board = readTaskboard()
  for (const col of Object.values(board.columns) as StoredTask[][]) {
    const task = col.find(t => t.id === taskId)
    if (task?.workflowId) {
      const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
      if (instance && instance.status !== 'complete') {
        throw new Error('This is a workflow task — use bakin_exec_submit_step to submit your step output instead of bakin_exec_tasks_complete.')
      }
      break
    }
  }

  await appendTaskLog(taskId, agent, `Task complete: ${summary}`)
  await moveTaskWithEffects(taskId, 'done', agent, { skipDoneGuard: true, channel })

  // Notify orchestrator
  const title = await resolveTitle(taskId)
  try {
    const runtime = getAppServices().runtime
    const orchestratorId = await getRuntimeMainAgentId(runtime)
    await runtime.messaging.send({
      agentId: orchestratorId,
      content: `TASK COMPLETE: ${title} — ${summary}`,
    })
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
  await setStoredDependency(taskId, dependsOn)
  appendAudit(getContentDir(), 'task.dependency_set', 'api', { id: taskId, dependsOn }, channel)
}

/**
 * Get task details by ID.
 * Returns the task object or null if not found.
 */
export async function getTaskDetails(taskId: string): Promise<{
  task: Record<string, unknown>
  column: string
} | null> {
  const result = getTaskWithColumn(taskId)
  return result ? { task: result.task as unknown as Record<string, unknown>, column: result.column } : null
}

/**
 * Trigger the dispatch cycle. Fire-and-forget.
 */
export function triggerDispatch(): void {
  const port = getPort()
  fetch(`http://localhost:${port}/api/dispatch`, { method: 'POST' }).catch(() => {})
}
