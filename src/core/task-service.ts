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
import { getAppServices } from './app-services-store'
import { meterAgentTurn } from './agent-cost'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { TaskSource } from '@bakin/core/tasks/store'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { assertWorkflowToolAllowed } from './workflow-tool-authorization'
import { bumpHeartbeatByTask, deleteCompletion, getLiveRun, hasCompletion, recordCompletion } from './execution-ledger'
import {
  addTaskLog as appendTaskLog,
  blockTask as blockStoredTask,
  createTask as createStoredTask,
  getTasksByColumn,
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

/**
 * Workflow done-guard rejection — a TYPED class so route/tool callers
 * classify by instanceof, never by message text (R28 discipline applies to
 * Bakin-owned errors too; the tasks move route maps this to 403).
 */
export class WorkflowTaskMoveError extends Error {
  constructor() {
    super('Workflow tasks cannot be moved to Done directly. Use bakin_exec_submit_step — the workflow engine manages task completion.')
    this.name = 'WorkflowTaskMoveError'
  }
}

// ---------------------------------------------------------------------------
// Ledger sync helpers
// ---------------------------------------------------------------------------

/**
 * Reopen: moving a completed task anywhere active deletes its completion
 * row (the ONLY unfreeze path) so the next completion is a fresh
 * first-write. Archiving a done task is lifecycle, not reopen.
 */
export function reopenIfLeavingDone(taskId: string, to: string, agent: string, channel?: Channel): void {
  const toLowerCased = to.toLowerCase()
  if (toLowerCased === 'done' || toLowerCased === 'archived') return
  if (!hasCompletion(taskId)) return
  deleteCompletion(taskId)
  appendAudit(getContentDir(), 'task.reopened', agent, { id: taskId, to }, channel)
}

/**
 * Ledger-aware raw store move for callers that bypass moveTaskWithEffects'
 * full side-effect pipeline (the workflow engine). Keeps the completions
 * table in sync in BOTH directions: leaving done deletes the row (reopen),
 * landing on done records one. The record is insert-if-missing — a
 * duplicate landing is a silent no-op, never an error — and only happens
 * after the store move succeeds, so a row still implies the board reached
 * done.
 */
export async function syncLedgerForStoreMove(
  taskId: string,
  to: string,
  agent: string,
  opts?: { from?: string; channel?: Channel },
): Promise<void> {
  reopenIfLeavingDone(taskId, to, agent, opts?.channel)
  await moveStoredTask(taskId, to, opts?.from, opts?.channel)
  if (to.toLowerCase() === 'done') {
    recordCompletion(taskId, { runId: getLiveRun(taskId)?.runId, agent, channel: opts?.channel })
  }
}

/**
 * Boot-time heal: every done-column task without a completions row gets a
 * synthetic one stamped with the task's updatedAt. Pre-ledger done tasks are
 * the main population; the heal also reconverges any row lost to a since-fixed
 * leak path. Idempotent (recordCompletion is insert-if-missing), so it simply
 * runs every boot — after it, "completions row" ⟺ "task is done" holds for
 * every reader and readTaskOutcome needs no done-column fallback. Done-column
 * only: archived-without-row stays untouched (a human force-archive may never
 * have been done).
 */
export function backfillMissingCompletionRows(): number {
  let healed = 0
  for (const task of getTasksByColumn('done')) {
    if (hasCompletion(task.id)) continue
    const completedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : undefined
    const result = recordCompletion(task.id, { agent: 'system', now: completedAt })
    if (result.recorded) {
      appendAudit(getContentDir(), 'task.completion_backfilled', 'system', { id: task.id, title: task.title, completedAt })
      healed++
    }
  }
  return healed
}

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
  await assertWorkflowToolAllowed({ taskId, agent, action: 'progress-log' })
  // Broadcast to live activity feed first (never block on persistence)
  broadcast({ type: 'activity', agent, message, ts: new Date().toISOString(), taskId, ...(channel ? { channel } : {}) })
  // Progress is the watchdog's liveness signal — bump the run heartbeat so a
  // quiet-but-alive agent is never superseded. Advisory only: a ledger
  // hiccup must not break progress logging.
  try {
    bumpHeartbeatByTask(taskId)
  } catch (err) {
    log.debug('Run heartbeat bump failed', { taskId, err: err instanceof Error ? err.message : String(err) })
  }
  await appendTaskLog(taskId, agent, message)
}

/**
 * Move a task between columns with all side effects.
 * Includes: audit, workflow done-guard, completion gate, continuation
 * trigger, search indexing.
 *
 * Moves to Done pass through the completion gate: the first writer wins the
 * completions row and fires the done side effects exactly once; every later
 * attempt (agent MCP retry, double-click, late zombie turn) is suppressed,
 * audited as task.completion_suppressed, and reported via
 * `alreadyComplete: true` — never an error.
 */
export async function moveTaskWithEffects(
  taskId: string,
  to: string,
  agent: string,
  opts?: { from?: string; skipDoneGuard?: boolean; channel?: Channel },
): Promise<{ alreadyComplete: boolean }> {
  const toLowerCased = to.toLowerCase()
  const movingToDone = toLowerCased === 'done'

  // Workflow done-guard: workflow tasks can only reach Done via the workflow engine
  // Human channel bypasses this guard — the operator can force any state
  if (movingToDone && !opts?.skipDoneGuard && opts?.channel !== 'human') {
    const board = readTaskboard()
    for (const col of Object.values(board.columns) as StoredTask[][]) {
      const task = col.find(t => t.id === taskId)
      if (task?.workflowId) {
        const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
        if (instance && instance.status !== 'complete') {
          throw new WorkflowTaskMoveError()
        }
        break
      }
    }
  }

  const before = getTaskWithColumn(taskId)
  const taskBeforeMove = before?.task

  reopenIfLeavingDone(taskId, to, agent, opts?.channel)

  // A done task "moved" to done again is a completion RETRY, not a move —
  // the store rejects done→done as an invalid transition, and a retry must
  // never error. Skip the redundant move; the completion gate below decides
  // whether this caller won (legacy done task without a row) or is
  // suppressed. Every other case still moves (including the crash-window
  // heal where a completion row exists but the column never reached done).
  const alreadyDone = (before?.column ?? '').toLowerCase() === 'done'
  if (!(movingToDone && alreadyDone)) {
    await moveStoredTask(taskId, to, opts?.from, opts?.channel)
  }

  // Completion gate — first write wins. The INSERT after the (idempotent)
  // column move means a completions row always implies the board reached
  // done; the suppressed branch above still converged the column.
  if (movingToDone) {
    const completion = recordCompletion(taskId, {
      runId: getLiveRun(taskId)?.runId,
      agent,
      channel: opts?.channel,
    })
    if (!completion.recorded) {
      appendAudit(getContentDir(), 'task.completion_suppressed', agent, {
        id: taskId,
        title: taskBeforeMove?.title,
        firstCompletedAt: completion.existing.completedAt,
        firstAgent: completion.existing.agent,
        firstChannel: completion.existing.channel,
      }, opts?.channel)
      return { alreadyComplete: true }
    }
  }

  const title = await resolveTitle(taskId)
  appendAudit(getContentDir(), 'task.moved', agent, { id: taskId, title, from: opts?.from, to }, opts?.channel)
  if (movingToDone) {
    appendAudit(getContentDir(), 'task.completed', agent, { id: taskId, title, runId: getLiveRun(taskId)?.runId ?? null }, opts?.channel)
  }
  recordUsage({
    kind: 'agent',
    activityClass: 'user',
    name: `task.${to.toLowerCase()}`,
    agent,
    durationMs: null,
    status: 'ok',
    meta: { taskId, previousStatus: opts?.from, title },
  })

  hooks().callAll('tasks.statusChanged', {
    taskId,
    title,
    from: opts?.from,
    to,
    agent,
    channel: opts?.channel,
    task: taskBeforeMove,
  }).catch((err) => {
    log.debug('Task status extension hook failed', { taskId, err: err instanceof Error ? err.message : String(err) })
  })

  // Side effects when moved to done — only the completion-gate winner
  // reaches this branch, so continuation fires exactly once per completion.
  if (movingToDone) {
    // Search indexing handled by tasks plugin via ctx.search
    checkAndContinueDependents(taskId, title, getContentDir(), { port: getPort() }).catch((err) => {
      log.error('Continuation trigger failed', err)
    })
    // Purge clipboard-source assets if the setting is enabled
    hooks().invoke('assets.purgeClipboardForTask', { taskId }).catch(() => {})
  }

  // Auto-unblock parent when a child workflow task moves out of blocked
  const toLower = toLowerCased
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

  return { alreadyComplete: false }
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
): Promise<{ alreadyComplete: boolean }> {
  await assertWorkflowToolAllowed({ taskId, agent, action: 'task-block' })
  // Completion guard — channel-independent, so it also covers the human
  // kanban drag that bypasses the store's transition table. A completed
  // task cannot be blocked; the row stays authoritative until an explicit
  // reopen (move out of Done). No side effects fire on the guarded path.
  if (hasCompletion(taskId)) {
    return { alreadyComplete: true }
  }
  await blockStoredTask(taskId, reason, agent, channel)
  const title = await resolveTitle(taskId)
  const contentDir = getContentDir()
  appendAudit(contentDir, 'task.blocked', agent, { id: taskId, title, reason }, channel)
  recordUsage({
    kind: 'agent',
    activityClass: 'user',
    name: 'task.blocked',
    agent,
    durationMs: null,
    status: 'ok',
    meta: { taskId, title, reason },
  })

  try {
    await getHookRegistry().invoke('workflows.cancelInstance', {
      taskId,
      reason: `Task blocked: ${reason}`,
      actor: { source: agent === 'system' || agent === 'human' ? agent : 'agent', id: agent, displayName: agent },
    })
  } catch (err) {
    log.debug('Could not cancel workflow for blocked task', { taskId, err: err instanceof Error ? err.message : String(err) })
  }

  // Propagate block to parent task for child workflow tasks (e.g., "parentId--stepId")
  const dashIdx = taskId.indexOf('--')
  if (dashIdx > 0) {
    const parentTaskId = taskId.slice(0, dashIdx)
    const parentTitle = await resolveTitle(parentTaskId)
    const childReason = `Child workflow blocked: ${reason}`
    try {
      // Deliberately no channel: propagation is a system action, so a done
      // parent is rejected by the store's transition table even when the
      // child block came from a human — reopen the parent first if needed.
      await blockStoredTask(parentTaskId, childReason, 'system')
      appendAudit(contentDir, 'task.blocked', 'system', { id: parentTaskId, title: parentTitle, reason: childReason, blockedBy: taskId }, channel)
      log.info('Parent task blocked due to child', { parentTaskId, childTaskId: taskId })
    } catch (err) {
      // Parent may already be done (transition rejected) or in another state
      // that can't transition — skip propagation, the child block stands
      log.info('Did not propagate block to parent', { parentTaskId, err: err instanceof Error ? err.message : String(err) })
    }
  }

  return { alreadyComplete: false }
}

/**
 * Create a task with audit logging.
 * Returns the created task.
 */
/**
 * Write-time assignment validation failure (#189, review R10). API surfaces
 * map this to a 400 by TYPE — never by message text (house rule).
 */
export type TaskValidationCode = 'both_set' | 'unknown_team' | 'validation_unavailable'

export class TaskValidationError extends Error {
  /** Typed classification — consumers branch on this, never message text. */
  readonly code: TaskValidationCode
  constructor(message: string, code: TaskValidationCode) {
    super(message)
    this.name = 'TaskValidationError'
    this.code = code
  }
}

/**
 * Write-time validation for a team reference (#189). Fails closed: an
 * unknown team OR an unavailable team plugin rejects the write — a bad
 * team id must never be stored and discovered at dispatch.
 */
export async function validateTeamRef(teamId: string): Promise<void> {
  const registry = hooks()
  if (!registry.has('team.exists')) {
    throw new TaskValidationError(`Cannot validate team "${teamId}": team plugin unavailable`, 'validation_unavailable')
  }
  const exists = await registry.invoke<boolean>('team.exists', { teamId })
  if (!exists) {
    throw new TaskValidationError(`Unknown team: "${teamId}"`, 'unknown_team')
  }
}

/**
 * The ONE agent/team assignment guard every write surface uses (review
 * R10): mutual exclusion + team existence, throwing TaskValidationError.
 */
export async function validateTeamAssignment(opts: { assignee?: string; team?: string }): Promise<void> {
  if (opts.assignee && opts.team) {
    throw new TaskValidationError('Cannot set both an agent and a team', 'both_set')
  }
  if (opts.team) {
    await validateTeamRef(opts.team)
  }
}

export async function createTaskWithEffects(opts: {
  id?: string
  title: string
  column?: string
  assignee?: string
  /** Team assignment (#189) — mutually exclusive with assignee. */
  team?: string
  description?: string
  workflowId?: string
  skipWorkflowReason?: string
  createdBy?: string
  parentId?: string
  projectId?: string
  brandId?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  scheduleJobId?: string
  dependsOn?: string
  date?: string
  channel?: Channel
  /** When creating directly into the blocked column, the reason shown to the user. */
  blockedReason?: string
  /** INTERNAL (schedule fire path): the caller already ran — or has
   * deliberately deferred — assignment validation (round-4 review: the
   * fire-time validation_unavailable defer was dead because this function
   * re-validated against the same unavailable plugin and threw). API
   * surfaces must never set this. */
  skipAssignmentValidation?: boolean
}): Promise<{ id: string; workflowId?: string; suggestedWorkflow?: string }> {
  if (!opts.skipAssignmentValidation) {
    await validateTeamAssignment({ assignee: opts.assignee, team: opts.team })
  }

  // Auto-match workflow if none was explicitly provided
  const suggested = !opts.workflowId ? (await hooks().invoke<string | null>('workflows.matchWorkflow', { title: opts.title, description: opts.description }) || undefined) : undefined
  const effectiveWorkflowId = opts.workflowId || undefined

  // Validate that the workflow actually exists BEFORE writing any task row.
  // Without this, agents (or buggy callers) can create tasks pointing at
  // bogus workflowIds, which then poison the dispatch loop forever.
  if (effectiveWorkflowId) {
    const def = await hooks().invoke<Record<string, unknown> | null>('workflows.loadDefinition', { name: effectiveWorkflowId })
    if (!def) {
      const available = await hooks().invoke<Array<{ name: string }>>('workflows.definitions.list', {}) ?? []
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
    {
      availableAt: opts.availableAt,
      dueAt: opts.dueAt,
      source: opts.source,
      scheduleJobId: opts.scheduleJobId,
      dependsOn: opts.dependsOn,
      team: opts.team,
      brandId: opts.brandId,
    },
  )

  if (opts.date) {
    await updateStoredTask(task.id, { date: opts.date })
  }

  if (opts.blockedReason) {
    await updateStoredTask(task.id, { blockedReason: opts.blockedReason })
  }

  // Start workflow instance if one was specified
  if (effectiveWorkflowId) {
    try {
      await hooks().invoke<void>('workflows.createInstance', { taskId: task.id, workflowId: effectiveWorkflowId, assignee: opts.assignee })
      log.info('Started workflow', { taskId: task.id, workflowId: effectiveWorkflowId })
      broadcast({ type: 'workflow_started', taskId: task.id, workflowId: effectiveWorkflowId })
    } catch (err) {
      log.error('Failed to start workflow', { taskId: task.id, workflowId: effectiveWorkflowId, error: (err as Error).message })
      await updateStoredTask(task.id, { workflowId: undefined })
      throw new Error(`Failed to start workflow "${effectiveWorkflowId}": ${(err as Error).message}`)
    }
  }

  appendAudit(getContentDir(), 'task.created', opts.createdBy || 'system', {
    id: task.id,
    title: opts.title,
    assignee: opts.assignee,
    team: opts.team,
    workflowId: effectiveWorkflowId,
    availableAt: opts.availableAt,
    dueAt: opts.dueAt,
    source: opts.source,
    skipWorkflowReason: opts.skipWorkflowReason,
    suggestedWorkflow: suggested,
  }, opts.channel)
  recordUsage({
    kind: 'agent',
    activityClass: 'user',
    name: 'task.created',
    agent: opts.createdBy || 'system',
    durationMs: null,
    status: 'ok',
    meta: {
      taskId: task.id,
      title: opts.title,
      assignee: opts.assignee,
      workflowId: effectiveWorkflowId,
      availableAt: opts.availableAt,
      dueAt: opts.dueAt,
      source: opts.source,
    },
  })
  return { id: task.id, workflowId: effectiveWorkflowId, suggestedWorkflow: suggested }
}

/**
 * Report a task as complete.
 * Rejects workflow tasks (they must use bakin_exec_submit_step).
 * Moves to done through the completion gate; only the first completion logs
 * the summary and notifies the orchestrator. Retries (agent timeout replay,
 * double-click) get `alreadyComplete: true` — never an error.
 */
export async function reportComplete(
  taskId: string,
  agent: string,
  summary: string,
  channel?: Channel,
): Promise<{ alreadyComplete: boolean }> {
  await assertWorkflowToolAllowed({ taskId, agent, action: 'task-complete' })
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

  const { alreadyComplete } = await moveTaskWithEffects(taskId, 'done', agent, { skipDoneGuard: true, channel })
  if (alreadyComplete) {
    return { alreadyComplete: true }
  }

  await appendTaskLog(taskId, agent, `Task complete: ${summary}`)

  // Notify orchestrator
  const title = await resolveTitle(taskId)
  try {
    const runtime = getAppServices().runtime
    const orchestratorId = await getRuntimeMainAgentId(runtime)
    const result = await runtime.messaging.send({
      agentId: orchestratorId,
      activityClass: 'system',
      content: `TASK COMPLETE: ${title} — ${summary}`,
    })
    await meterAgentTurn({ agent: orchestratorId, activityClass: 'system', result, name: 'orchestrator-notify' })
  } catch (err) {
    log.warn('Failed to notify orchestrator of task completion', err)
  }

  return { alreadyComplete: false }
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
