/**
 * Bakin-owned task metadata service.
 *
 * Task metadata lives exclusively in the JSON task store under
 * getBakinPaths().tasks. This module is the board-shaped service layer used by
 * core, plugins, routes, and scripts; plugin hooks are not the persistence
 * boundary.
 */
import {
  createFileBakinTaskStore,
  type BakinTask,
  type BakinTaskPatch,
  type SyncBakinTaskStore,
  type TaskLogEntry,
  type TaskSource,
} from '@bakin/core/tasks/store'
import { generateTaskId } from '@bakin/core/ids'
import { join } from 'path'
import { getBakinPaths, getContentDir } from './content-dir'
import { purgeTaskRows } from './execution-ledger'
import { abortTurnsForTask } from './dispatch-registry'
import { createLogger } from './logger'

const log = createLogger('task-store')

// TaskLogEntry is single-homed in the SDK; re-exported via @bakin/core/tasks/store.
export type { TaskLogEntry, TaskSource } from '@bakin/core/tasks/store'

export interface Task {
  id: string
  title: string
  agent?: string
  /** Requested team (#189); present alongside agent once resolved. */
  team?: string
  createdBy?: string
  checked: boolean
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  /** Brand link (#419) — resolved lazily at dispatch, mirrors projectId. */
  brandId?: string
  repoPath?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  order?: number
  updatedAt?: number
  /** Optimistic concurrency counter (absent = 0 on pre-upgrade tasks). */
  version?: number
}

export interface TaskColumns {
  backlog: Task[]
  inProgress: Task[]
  todo: Task[]
  review: Task[]
  done: Task[]
  archived: Task[]
  blocked: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns

export const VALID_TRANSITIONS: Record<ColumnId, ColumnId[]> = {
  backlog: ['todo'],
  todo: ['inProgress', 'blocked', 'done', 'backlog'],
  inProgress: ['review', 'done', 'blocked', 'todo'],
  blocked: ['todo', 'inProgress', 'backlog'],
  review: ['done', 'inProgress', 'todo'],
  done: ['archived', 'todo', 'inProgress'],
  archived: ['done', 'todo'],
}

type StoreGlobal = typeof globalThis & {
  __bakinTaskStores?: Map<string, SyncBakinTaskStore>
}

export function getSharedBakinTaskStore(): SyncBakinTaskStore {
  const root = (getBakinPaths() as { tasks?: string }).tasks ?? join(getContentDir(), 'tasks')
  const g = globalThis as StoreGlobal
  g.__bakinTaskStores ??= new Map()
  let store = g.__bakinTaskStores.get(root)
  if (!store) {
    store = createFileBakinTaskStore(root)
    store.subscribe(() => broadcastChange())
    g.__bakinTaskStores.set(root, store)
  }
  return store
}

function broadcastChange(): void {
  const fn = (globalThis as Record<string, unknown>).__bakinBroadcast as ((data: Record<string, unknown>) => void) | undefined
  if (fn) fn({ type: 'taskboard', event: 'change', timestamp: new Date().toISOString() })
}

/** Returns today's date as YYYY-MM-DD in the server's local timezone. */
export function localDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function normalizeColumn(col: string): ColumnId | null {
  const lower = col.toLowerCase().replace(/[^a-z]/g, '')
  if (lower === 'backlog') return 'backlog'
  if (lower === 'inprogress') return 'inProgress'
  if (lower === 'todo') return 'todo'
  if (lower === 'review') return 'review'
  if (lower === 'done') return 'done'
  if (lower === 'archived') return 'archived'
  if (lower === 'blocked') return 'blocked'
  return null
}

function emptyColumns(): TaskColumns {
  return { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] }
}

function asColumnId(task: BakinTask): ColumnId {
  return normalizeColumn(task.column) ?? 'backlog'
}

function taskToView(task: BakinTask): Task {
  const column = asColumnId(task)
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    team: task.team,
    createdBy: task.createdBy,
    checked: column === 'done' || column === 'archived',
    date: task.date,
    blockedReason: task.blockedReason,
    description: task.description,
    log: task.log,
    dependsOn: task.dependsOn,
    parentId: task.parentId ?? undefined,
    workflowId: task.workflowId,
    scheduleJobId: task.scheduleJobId,
    projectId: task.projectId,
    brandId: task.brandId,
    repoPath: task.repoPath,
    availableAt: task.availableAt,
    dueAt: task.dueAt,
    source: task.source,
    order: task.order,
    updatedAt: Date.parse(task.updatedAt),
    version: task.version ?? 0,
  }
}

function findTask(identifier: string): BakinTask | null {
  return getSharedBakinTaskStore().findSync(identifier)
}

function requireTask(identifier: string): BakinTask {
  const task = findTask(identifier)
  if (!task) throw new Error(`Task not found: ${identifier}`)
  return task
}

function getColumnTaskCount(col: ColumnId): number {
  return getSharedBakinTaskStore().countByColumnSync(col)
}

function columnPatch(col: ColumnId): BakinTaskPatch {
  const patch: BakinTaskPatch = {
    column: col,
    order: getColumnTaskCount(col),
  }

  if (col === 'inProgress' || col === 'review' || col === 'done' || col === 'archived') {
    patch.date = localDateString()
  } else {
    patch.date = undefined
  }

  if (col !== 'blocked') patch.blockedReason = undefined
  return patch
}

function assertTransitionAllowed(task: BakinTask, toCol: ColumnId, isHuman: boolean): void {
  if (isHuman) return
  const currentCol = asColumnId(task)
  const allowed = VALID_TRANSITIONS[currentCol]
  if (allowed && !allowed.includes(toCol)) {
    throw new Error(`Invalid transition: ${currentCol} -> ${toCol}. Allowed: ${allowed.join(', ') || 'none'}`)
  }
  if (toCol === 'done' && task.log.length === 0) {
    throw new Error('Cannot move to done: task has no log entries. Log your work first via bakin_exec_tasks_log_progress')
  }
}

async function invokeWorkflowHook(hook: 'workflows.cancelInstance' | 'workflows.deleteInstance', taskId: string): Promise<void> {
  try {
    const { getHookRegistry } = await import('@bakin/core/hooks/hook-registry-singleton')
    await getHookRegistry().invoke(hook, { taskId })
  } catch {
    // Best effort: workflows may not be activated in tests or early boot.
  }
}

async function cancelWorkflowInstance(taskId: string): Promise<void> {
  return invokeWorkflowHook('workflows.cancelInstance', taskId)
}

export function readTaskboard(): TaskBoard {
  const columns = emptyColumns()
  for (const task of getSharedBakinTaskStore().listSync()) {
    columns[asColumnId(task)].push(taskToView(task))
  }
  return { columns }
}

export { readTaskboard as getAllTasks }

export function getTask(id: string): Task | null {
  const task = getSharedBakinTaskStore().getSync(id)
  return task ? taskToView(task) : null
}

export function getTaskWithColumn(id: string): { task: Task; column: ColumnId } | null {
  const task = getSharedBakinTaskStore().getSync(id)
  if (!task) return null
  return { task: taskToView(task), column: asColumnId(task) }
}

export function getTasksByColumn(column: ColumnId): Task[] {
  return getSharedBakinTaskStore().listSync({ column }).map(taskToView)
}

export function getTasksByAgent(agent: string): Task[] {
  return getSharedBakinTaskStore().listSync({ agent }).map(taskToView)
}

export function readAllColumns(): TaskColumns {
  return readTaskboard().columns
}

export function getTodoTasks(): { columns: TaskColumns; todoTasks: Task[] } {
  const { columns } = readTaskboard()
  return { columns, todoTasks: [...columns.todo] }
}

export function getAgentTasks(agentId: string): Task[] {
  return getSharedBakinTaskStore()
    .listSync({ agent: agentId, column: 'todo' })
    .map(taskToView)
}

export function createTask(
  title: string,
  column?: string,
  assignee?: string,
  description?: string,
  workflowId?: string,
  createdBy?: string,
  id?: string,
  parentId?: string,
  projectId?: string,
  options?: {
    availableAt?: string
    dueAt?: string
    source?: TaskSource
    scheduleJobId?: string
    dependsOn?: string
    /** Team assignment (#189) — mutually exclusive with assignee. */
    team?: string
    /** Brand link (#419). */
    brandId?: string
    /** Repo binding override (same-agent-concurrency D6). */
    repoPath?: string
  },
): Promise<Task> {
  try {
    if (assignee && options?.team) {
      throw new Error('Cannot set both an agent and a team on a task')
    }
    const colId = column ? (normalizeColumn(column) || 'todo') : 'todo'
    const store = getSharedBakinTaskStore()
    const task = store.createSync({
      id: id || generateTaskId(),
      title,
      description,
      agent: assignee,
      team: options?.team,
      createdBy,
      parentId,
      workflowId,
      projectId,
      brandId: options?.brandId,
      repoPath: options?.repoPath,
      scheduleJobId: options?.scheduleJobId,
      dependsOn: options?.dependsOn,
      availableAt: options?.availableAt,
      dueAt: options?.dueAt,
      source: options?.source,
      column: colId,
      order: getColumnTaskCount(colId),
    })

    const patch: BakinTaskPatch = {}
    if (colId === 'inProgress' || colId === 'review' || colId === 'done' || colId === 'archived') {
      patch.date = localDateString()
    }
    if (Object.keys(patch).length > 0) {
      return Promise.resolve(taskToView(store.updateSync(task.id, patch)))
    }
    return Promise.resolve(taskToView(task))
  } catch (err) {
    return Promise.reject(err)
  }
}

export function moveTask(identifier: string, to: string, _from?: string, channel?: string): Promise<void> {
  try {
    const toCol = normalizeColumn(to)
    if (!toCol) throw new Error(`Invalid column: ${to}`)

    const task = requireTask(identifier)
    const currentCol = asColumnId(task)
    const isHuman = channel === 'human'
    assertTransitionAllowed(task, toCol, isHuman)

    getSharedBakinTaskStore().updateSync(task.id, columnPatch(toCol))

    if ((toCol === 'done' || toCol === 'blocked') && currentCol === 'inProgress') {
      void cancelWorkflowInstance(task.id)
    }

    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function assignTask(identifier: string, agent: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    // Direct re-assignment intent clears the requested team; a same-value
    // re-write (dispatch move of a resolved team task) and an unassign both
    // retain it — see the team-assignment invariant in the tests.
    const clearsTeam = !!agent && agent !== task.agent
    getSharedBakinTaskStore().updateSync(task.id, {
      agent: agent || undefined,
      ...(clearsTeam ? { team: undefined } : {}),
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

/** Assign a task to a team (#189): sets `team`, clears any concrete agent so
 * the dispatch resolver picks a member fresh. */
export function assignTaskToTeam(identifier: string, team: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    getSharedBakinTaskStore().updateSync(task.id, { team: team || undefined, agent: undefined })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

/** Dispatch-only (#189): persist the resolver's pick into `agent` while
 * RETAINING `team` — the record must keep explaining requested vs resolved.
 * Assignment-intent surfaces must use assignTask/updateTask instead. */
export function recordTeamResolution(identifier: string, agent: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    getSharedBakinTaskStore().updateSync(task.id, { agent })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

/**
 * The ONE canonical task-delete path — every entry point (REST, MCP exec
 * tool, plugin SDK) gets the full cascade (#604 T5):
 *   abort in-flight turns → cancel workflow instance → delete instance file
 *   → purge ledger rows → remove the task file.
 * The task file goes LAST: a mid-delete crash leaves a visible task rather
 * than invisible half-cleaned debris. Every step before it is best-effort.
 *
 * Returns the RESOLVED task id — `identifier` may be a title, and callers'
 * follow-up effects (audit, search-doc removal) must key on the real id.
 */
export async function deleteTask(identifier: string): Promise<string> {
  const task = requireTask(identifier)
  // Abort FIRST, while the ledger/registry state is still coherent — the
  // 'aborted' settle branch must not race a half-deleted task.
  // (dispatch-registry is a leaf module — no dispatch fire-core import cycle.)
  abortTurnsForTask(task.id, 'task-deleted')
  await invokeWorkflowHook('workflows.cancelInstance', task.id)
  await invokeWorkflowHook('workflows.deleteInstance', task.id)
  // Cascade the execution ledger: frees any live run claim and drops the
  // task's runs/completions/watermarks. Advisory — a ledger hiccup must
  // not block deletion (the boot sweep reaps stragglers).
  try {
    purgeTaskRows(task.id)
  } catch (err) {
    log.warn('Ledger purge failed for deleted task; boot sweep will reap', { taskId: task.id, err: err instanceof Error ? err.message : String(err) })
  }
  getSharedBakinTaskStore().removeSync(task.id)
  return task.id
}

export function addTaskLog(identifier: string, author: string, message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    const task = requireTask(identifier)
    getSharedBakinTaskStore().appendLogSync(task.id, { timestamp: new Date().toISOString(), author, message, ...(data ? { data } : {}) })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function blockTask(identifier: string, reason: string, agent?: string, channel?: string): Promise<void> {
  try {
    void agent
    const task = requireTask(identifier)
    // Re-blocking an already-blocked task is an idempotent reason update —
    // retries must never error. Every other source column goes through the
    // same transition table as moveTask, so done → blocked is rejected for
    // non-human callers instead of silently un-doneing a completed task.
    if (asColumnId(task) !== 'blocked') {
      assertTransitionAllowed(task, 'blocked', channel === 'human')
    }
    getSharedBakinTaskStore().updateSync(task.id, {
      ...columnPatch('blocked'),
      blockedReason: reason,
      date: undefined,
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function updateTask(
  identifier: string,
  updates: {
    title?: string
    description?: string
    agent?: string
    team?: string
    column?: ColumnId
    workflowId?: string
    projectId?: string
    brandId?: string
    availableAt?: string | null
    dueAt?: string | null
    source?: TaskSource | null
    scheduleJobId?: string | null
    dependsOn?: string | null
    date?: string | null
    channel?: string
    blockedReason?: string
  },
): Promise<void> {
  try {
    const task = requireTask(identifier)
    const isHuman = updates.channel === 'human'
    const patch: BakinTaskPatch = {}

    if (updates.agent && updates.team) {
      throw new Error('Cannot set both an agent and a team on a task')
    }

    if ('title' in updates && updates.title !== undefined) patch.title = updates.title
    if ('description' in updates) patch.description = updates.description || undefined
    if ('agent' in updates) {
      patch.agent = updates.agent || undefined
      // Direct re-assignment to a DIFFERENT agent clears the requested team;
      // same-value re-writes (dispatch move) and unassigns retain it.
      if (updates.agent && updates.agent !== task.agent) patch.team = undefined
    }
    if ('team' in updates) {
      patch.team = updates.team || undefined
      // Assigning to a team resets any concrete agent → unresolved state.
      if (updates.team) patch.agent = undefined
    }
    if ('workflowId' in updates) patch.workflowId = updates.workflowId || undefined
    if ('projectId' in updates) patch.projectId = updates.projectId || undefined
    if ('brandId' in updates) patch.brandId = updates.brandId || undefined
    if ('availableAt' in updates) patch.availableAt = updates.availableAt || undefined
    if ('dueAt' in updates) patch.dueAt = updates.dueAt || undefined
    if ('source' in updates) patch.source = updates.source || undefined
    if ('scheduleJobId' in updates) patch.scheduleJobId = updates.scheduleJobId || undefined
    if ('dependsOn' in updates) patch.dependsOn = updates.dependsOn || undefined
    if ('date' in updates) patch.date = updates.date || undefined
    if ('blockedReason' in updates) patch.blockedReason = updates.blockedReason || undefined

    if (updates.column !== undefined && updates.column !== asColumnId(task)) {
      assertTransitionAllowed(task, updates.column, isHuman)
      Object.assign(patch, columnPatch(updates.column))
    }

    getSharedBakinTaskStore().updateSync(task.id, patch)
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function setDependency(taskId: string, dependsOnId: string): Promise<void> {
  try {
    const task = requireTask(taskId)
    getSharedBakinTaskStore().updateSync(task.id, {
      dependsOn: dependsOnId,
      blockedBy: [dependsOnId],
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function clearDependency(taskId: string): Promise<void> {
  try {
    const task = requireTask(taskId)
    getSharedBakinTaskStore().updateSync(task.id, {
      dependsOn: undefined,
      blockedBy: [],
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function reorderTasks(_columnId: ColumnId, orderedIds: string[]): Promise<void> {
  try {
    const store = getSharedBakinTaskStore()
    for (let i = 0; i < orderedIds.length; i++) {
      const task = store.getSync(orderedIds[i])
      if (task) store.updateSync(task.id, { order: i })
    }
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function moveTaskToInProgress(identifier: string, agentTag?: string): Promise<void> {
  try {
    const task = findTask(identifier)
    if (!task || asColumnId(task) !== 'todo') return Promise.resolve()

    getSharedBakinTaskStore().updateSync(task.id, {
      ...columnPatch('inProgress'),
      agent: task.agent || agentTag || undefined,
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function archiveOldTasks(olderThanDays: number): number {
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)
  let removed = 0
  const store = getSharedBakinTaskStore()
  for (const task of store.listSync({ includePendingDelete: true })) {
    const col = asColumnId(task)
    if ((col === 'done' || col === 'archived') && Date.parse(task.updatedAt) < cutoff) {
      store.removeSync(task.id)
      // Same ledger cascade as deleteTask — without it, deleted tasks
      // orphan their completions/runs rows forever. Advisory.
      try {
        purgeTaskRows(task.id)
      } catch (err) {
        log.warn('Ledger purge failed for archived-away task', { taskId: task.id, err: err instanceof Error ? err.message : String(err) })
      }
      removed++
    }
  }
  return removed
}

export function getArchivedCount(): number {
  return getSharedBakinTaskStore().listSync({ column: 'archived' }).length
}

export function autoArchiveDoneTasks(olderThanMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs
  let archived = 0
  const store = getSharedBakinTaskStore()
  for (const task of store.listSync({ column: 'done' })) {
    if (Date.parse(task.updatedAt) < cutoff) {
      store.updateSync(task.id, columnPatch('archived'))
      archived++
    }
  }
  return archived
}
