/**
 * Bakin-owned task metadata store.
 *
 * This file keeps the old tasks plugin API stable while moving task metadata
 * into ~/.bakin/tasks.
 */
import { createFileBakinTaskStore, type BakinTask, type BakinTaskPatch, type SyncBakinTaskStore } from '@bakin/core/tasks/store'
import { getBakinPaths } from '@bakin/core/content-dir'
import { generateTaskId } from '@bakin/core/ids'
import { getHookRegistry } from '../../../src/lib/plugin-registry'
import type { Task, TaskColumns, TaskBoard, ColumnId } from '../types'

// Re-export valid transitions from constants (single source of truth)
export { VALID_TRANSITIONS } from '../constants'
import { VALID_TRANSITIONS } from '../constants'

type StoreGlobal = typeof globalThis & {
  __bakinTaskStores?: Map<string, SyncBakinTaskStore>
}

function getStore(): SyncBakinTaskStore {
  const root = getBakinPaths().tasks
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

// ---------------------------------------------------------------------------
// SSE broadcast helper
// ---------------------------------------------------------------------------

function broadcastChange(): void {
  const fn = (globalThis as Record<string, unknown>).__bakinBroadcast as ((data: Record<string, unknown>) => void) | undefined
  if (fn) fn({ type: 'taskboard', event: 'change', timestamp: new Date().toISOString() })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns today's date as YYYY-MM-DD in the server's local timezone. */
export function localDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function normalizeColumn(col: string): ColumnId | null {
  const lower = col.toLowerCase().replace(/[^a-z]/g, '')
  if (lower === 'backlog') return 'backlog'
  if (lower === 'inprogress' || lower === 'in_progress') return 'inProgress'
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
    order: task.order,
    updatedAt: Date.parse(task.updatedAt),
  }
}

function findTask(identifier: string): BakinTask | null {
  return getStore().findSync(identifier)
}

function requireTask(identifier: string): BakinTask {
  const task = findTask(identifier)
  if (!task) throw new Error(`Task not found: ${identifier}`)
  return task
}

function getColumnTaskCount(col: ColumnId): number {
  return getStore().listSync({ column: col }).length
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
    throw new Error(`Invalid transition: ${currentCol} → ${toCol}. Allowed: ${allowed.join(', ') || 'none'}`)
  }
  if (toCol === 'done' && task.log.length === 0) {
    throw new Error('Cannot move to done: task has no log entries. Log your work first via bakin_exec_tasks_log_progress')
  }
}

// ---------------------------------------------------------------------------
// Core read operations
// ---------------------------------------------------------------------------

export function readTaskboard(): TaskBoard {
  const columns = emptyColumns()
  for (const task of getStore().listSync()) {
    columns[asColumnId(task)].push(taskToView(task))
  }
  return { columns }
}

// Alias for hook compatibility
export { readTaskboard as getAllTasks }

export function getTask(id: string): Task | null {
  const task = getStore().getSync(id)
  return task ? taskToView(task) : null
}

export function getTaskWithColumn(id: string): { task: Task; column: ColumnId } | null {
  const task = getStore().getSync(id)
  if (!task) return null
  return { task: taskToView(task), column: asColumnId(task) }
}

export function getTasksByColumn(column: ColumnId): Task[] {
  return getStore().listSync({ column }).map(taskToView)
}

export function getTasksByAgent(agent: string): Task[] {
  return getStore().listSync({ agent }).map(taskToView)
}

export function readAllColumns(): TaskColumns {
  return readTaskboard().columns
}

export function getTodoTasks(): { columns: TaskColumns; todoTasks: Task[] } {
  const { columns } = readTaskboard()
  return { columns, todoTasks: [...columns.todo] }
}

export function getAgentTasks(agentId: string): Task[] {
  return getStore()
    .listSync({ agent: agentId, column: 'todo' })
    .map(taskToView)
}

// ---------------------------------------------------------------------------
// Core write operations (return Promises for backward compat)
// ---------------------------------------------------------------------------

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
): Promise<Task> {
  try {
    const colId = column ? (normalizeColumn(column) || 'todo') : 'todo'
    const task = getStore().createSync({
      id: id || generateTaskId(),
      title,
      description,
      agent: assignee,
      createdBy,
      parentId,
      workflowId,
      projectId,
      column: colId,
      order: getColumnTaskCount(colId),
    })

    const patch: BakinTaskPatch = {}
    if (colId === 'inProgress' || colId === 'review' || colId === 'done' || colId === 'archived') {
      patch.date = localDateString()
    }
    if (Object.keys(patch).length > 0) {
      return Promise.resolve(taskToView(getStore().updateSync(task.id, patch)))
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

    getStore().updateSync(task.id, columnPatch(toCol))

    if ((toCol === 'done' || toCol === 'blocked') && currentCol === 'inProgress') {
      void getHookRegistry()
        .invoke('workflows.cancelInstance', { taskId: task.id })
        .catch(() => { /* best effort */ })
    }

    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function assignTask(identifier: string, agent: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    getStore().updateSync(task.id, { agent: agent || undefined })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function deleteTask(identifier: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    getStore().removeSync(task.id)

    void getHookRegistry()
      .invoke('workflows.cancelInstance', { taskId: task.id })
      .catch(() => { /* best effort */ })

    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function addTaskLog(identifier: string, author: string, message: string): Promise<void> {
  try {
    const task = requireTask(identifier)
    getStore().appendLogSync(task.id, { timestamp: new Date().toISOString(), author, message })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function blockTask(identifier: string, reason: string, agent?: string): Promise<void> {
  try {
    void agent
    const task = requireTask(identifier)
    getStore().updateSync(task.id, {
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
  updates: { title?: string; description?: string; agent?: string; column?: ColumnId; workflowId?: string; projectId?: string; channel?: string },
): Promise<void> {
  try {
    const task = requireTask(identifier)
    const isHuman = updates.channel === 'human'
    const patch: BakinTaskPatch = {}

    if ('title' in updates && updates.title !== undefined) patch.title = updates.title
    if ('description' in updates) patch.description = updates.description || undefined
    if ('agent' in updates) patch.agent = updates.agent || undefined
    if ('workflowId' in updates) patch.workflowId = updates.workflowId || undefined
    if ('projectId' in updates) patch.projectId = updates.projectId || undefined

    if (updates.column !== undefined && updates.column !== asColumnId(task)) {
      assertTransitionAllowed(task, updates.column, isHuman)
      Object.assign(patch, columnPatch(updates.column))
    }

    getStore().updateSync(task.id, patch)
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

// ---------------------------------------------------------------------------
// Dependency helpers
// ---------------------------------------------------------------------------

export function setDependency(taskId: string, dependsOnId: string): Promise<void> {
  try {
    const task = requireTask(taskId)
    getStore().updateSync(task.id, {
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
    getStore().updateSync(task.id, {
      dependsOn: undefined,
      blockedBy: [],
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

// ---------------------------------------------------------------------------
// Reorder / dispatch helpers
// ---------------------------------------------------------------------------

export function reorderTasks(_columnId: ColumnId, orderedIds: string[]): Promise<void> {
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      const task = getStore().getSync(orderedIds[i])
      if (task) getStore().updateSync(task.id, { order: i })
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

    getStore().updateSync(task.id, {
      ...columnPatch('inProgress'),
      agent: task.agent || agentTag || undefined,
    })
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

// ---------------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------------

export function archiveOldTasks(olderThanDays: number): number {
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)
  let removed = 0
  for (const task of getStore().listSync({ includePendingDelete: true })) {
    const col = asColumnId(task)
    if ((col === 'done' || col === 'archived') && Date.parse(task.updatedAt) < cutoff) {
      getStore().removeSync(task.id)
      removed++
    }
  }
  return removed
}

export function getArchivedCount(): number {
  return getStore().listSync({ column: 'archived' }).length
}

/**
 * Move done tasks older than `olderThanMs` to the archived column.
 * Returns the number of tasks archived.
 */
export function autoArchiveDoneTasks(olderThanMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs
  let archived = 0
  for (const task of getStore().listSync({ column: 'done' })) {
    if (Date.parse(task.updatedAt) < cutoff) {
      getStore().updateSync(task.id, columnPatch('archived'))
      archived++
    }
  }
  return archived
}
