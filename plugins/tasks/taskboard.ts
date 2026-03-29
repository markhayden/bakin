/**
 * Server-side taskboard operations.
 * All mutations are serialized through an async mutex to prevent concurrent write races.
 */
import { readContentFile, writeContentFile } from '../../src/lib/content'
import { parseTasks } from './parser'
import { generateTaskId } from './ids'
import { cancelInstance } from '../workflows/runtime'
import type { Task, TaskColumns, ColumnId } from './types'

// Re-export for convenience
export { parseTasks as parseTaskboard } from './parser'
export { generateTaskId } from './ids'

// ---------------------------------------------------------------------------
// Async mutex — serializes all read-modify-write cycles on TASKBOARD.md
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve()

export function withTaskboardLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn) as Promise<T>
  writeQueue = next.then(() => {}, () => {})
  return next
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLUMN_TO_HEADER: Record<ColumnId, string> = {
  backlog: '📦 Backlog',
  inProgress: '🔵 In Progress',
  todo: '📋 Todo',
  review: '🔍 Review',
  done: '✅ Done',
  confirmed: '🟣 Confirmed',
  blocked: '🔴 Blocked',
}

const KNOWN_AGENTS = ['roscoe', 'patch', 'pixel', 'rolo', 'basil']

// ---------------------------------------------------------------------------
// Valid state transitions — prevents invalid column moves
// ---------------------------------------------------------------------------
export const VALID_TRANSITIONS: Record<ColumnId, ColumnId[]> = {
  backlog:    ['todo'],
  todo:       ['inProgress', 'blocked', 'done', 'backlog'],
  inProgress: ['review', 'done', 'blocked', 'todo'],
  blocked:    ['todo', 'inProgress', 'backlog'],
  review:     ['inProgress', 'todo'],
  done:       ['confirmed', 'todo'],
  confirmed:  [],
}

// ---------------------------------------------------------------------------
// Column normalization
// ---------------------------------------------------------------------------
function normalizeColumn(col: string): ColumnId | null {
  const lower = col.toLowerCase().replace(/[^a-z]/g, '')
  if (lower === 'backlog') return 'backlog'
  if (lower === 'inprogress' || lower === 'in_progress') return 'inProgress'
  if (lower === 'todo') return 'todo'
  if (lower === 'review') return 'review'
  if (lower === 'done') return 'done'
  if (lower === 'confirmed') return 'confirmed'
  if (lower === 'blocked') return 'blocked'
  return null
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------
export function serializeTaskboard(columns: TaskColumns): string {
  const now = new Date()
  const ts = now.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    hour12: false,
  })
  let md = `# Task Board\n_Last updated: ${ts}_\n`

  for (const colId of ['backlog', 'inProgress', 'todo', 'review', 'done', 'confirmed', 'blocked'] as ColumnId[]) {
    const header = COLUMN_TO_HEADER[colId]
    md += `\n## ${header}\n`
    for (const task of columns[colId]) {
      const check = task.checked ? 'x' : ' '
      let line = `- [${check}] [${task.id}] ${task.title}`
      if (task.agent) line += ` @${task.agent}`
      if (task.blockedReason) line += ` — BLOCKED: ${task.blockedReason}`
      else if (task.date) line += ` — ${task.date}`
      md += line + '\n'
      if (task.createdBy) {
        md += `  createdBy: ${task.createdBy}\n`
      }
      if (task.dependsOn) {
        md += `  dependsOn: ${task.dependsOn}\n`
      }
      if (task.workflowId) {
        md += `  workflow: ${task.workflowId}\n`
      }
      if (task.projectId) {
        md += `  projectId: ${task.projectId}\n`
      }
      if (task.description) {
        for (const descLine of task.description.split('\n')) {
          md += `  ${descLine}\n`
        }
      }
      if (task.log) {
        for (const entry of task.log) {
          md += `  [${entry.timestamp} ${entry.author}] ${entry.message}\n`
        }
      }
    }
  }
  return md
}

// ---------------------------------------------------------------------------
// Read / Write helpers
// ---------------------------------------------------------------------------
export function readTaskboard() {
  const content = readContentFile('TASKBOARD.md')
  if (!content) return { columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], confirmed: [], blocked: [] } as TaskColumns }
  return parseTasks(content)
}

export function writeTaskboard(columns: TaskColumns) {
  const content = serializeTaskboard(columns)
  writeContentFile('TASKBOARD.md', content)
}

// ---------------------------------------------------------------------------
// Find task by ID or title (ID preferred, title fallback)
// ---------------------------------------------------------------------------
function findTask(columns: TaskColumns, identifier: string): { task: Task; colId: ColumnId; idx: number } | null {
  for (const colId of Object.keys(columns) as ColumnId[]) {
    let idx = columns[colId].findIndex(t => t.id === identifier)
    if (idx !== -1) return { task: columns[colId][idx], colId, idx }
    idx = columns[colId].findIndex(t => t.title === identifier)
    if (idx !== -1) return { task: columns[colId][idx], colId, idx }
  }
  return null
}

// ---------------------------------------------------------------------------
// Mutations — all wrapped in the mutex
// ---------------------------------------------------------------------------
export function createTask(title: string, column?: string, assignee?: string, description?: string, workflowId?: string, createdBy?: string, id?: string, parentId?: string, projectId?: string): Promise<Task> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const colId = column ? (normalizeColumn(column) || 'todo') : 'todo'
    const task: Task = {
      id: id || generateTaskId(),
      title,
      agent: assignee,
      createdBy,
      checked: colId === 'done',
      description,
      parentId,
      workflowId,
      projectId,
    }
    if (colId === 'inProgress' || colId === 'done') {
      task.date = new Date().toISOString().split('T')[0]
    }
    columns[colId].push(task)
    writeTaskboard(columns)
    return task
  })
}

export function moveTask(identifier: string, to: string, from?: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const toCol = normalizeColumn(to)
    if (!toCol) throw new Error(`Invalid column: ${to}`)

    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)

    const { task, colId, idx } = found

    // State transition guard
    const allowed = VALID_TRANSITIONS[colId]
    if (allowed && !allowed.includes(toCol)) {
      throw new Error(`Invalid transition: ${colId} → ${toCol}. Allowed: ${allowed.join(', ') || 'none'}`)
    }

    // Require at least one log entry before moving to done
    if (toCol === 'done' && (!task.log || task.log.length === 0)) {
      throw new Error('Cannot move to done: task has no log entries. Log your work first via POST /api/tasks/log')
    }

    columns[colId].splice(idx, 1)
    task.checked = toCol === 'done'
    if (toCol === 'inProgress' || toCol === 'review' || toCol === 'done') {
      task.date = new Date().toISOString().split('T')[0]
    }
    if (toCol !== 'blocked') {
      task.blockedReason = undefined
    }
    columns[toCol].push(task)
    writeTaskboard(columns)

    // Cancel active workflow instances when task leaves in-progress outside the workflow
    if ((toCol === 'done' || toCol === 'blocked') && colId === 'inProgress') {
      try { cancelInstance(task.id) } catch { /* best effort */ }
    }
  })
}

export function assignTask(identifier: string, agent: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)
    found.task.agent = agent || undefined
    writeTaskboard(columns)
  })
}

export function deleteTask(identifier: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)
    const taskId = found.task.id
    columns[found.colId].splice(found.idx, 1)
    writeTaskboard(columns)

    // Cancel any active workflow instances
    try { cancelInstance(taskId) } catch { /* best effort */ }
  })
}

export function addTaskLog(identifier: string, author: string, message: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)
    if (!found.task.log) found.task.log = []
    const ts = new Date().toISOString()
    found.task.log.push({ timestamp: ts, author, message })
    writeTaskboard(columns)
  })
}

export function blockTask(identifier: string, reason: string, agent?: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)

    const { task, colId, idx } = found
    columns[colId].splice(idx, 1)
    task.checked = false
    task.blockedReason = reason
    task.date = undefined
    columns.blocked.push(task)
    writeTaskboard(columns)
  })
}

export function updateTask(
  identifier: string,
  updates: { title?: string; description?: string; agent?: string; column?: ColumnId; workflowId?: string; projectId?: string }
): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) throw new Error(`Task not found: ${identifier}`)

    const { task, colId, idx } = found
    if (updates.title !== undefined) task.title = updates.title
    if (updates.description !== undefined) task.description = updates.description || undefined
    if (updates.agent !== undefined) task.agent = updates.agent || undefined
    if (updates.workflowId !== undefined) task.workflowId = updates.workflowId || undefined
    if (updates.projectId !== undefined) task.projectId = updates.projectId || undefined

    if (updates.column !== undefined && updates.column !== colId) {
      const allowed = VALID_TRANSITIONS[colId]
      if (allowed && !allowed.includes(updates.column)) {
        throw new Error(`Invalid transition: ${colId} → ${updates.column}. Allowed: ${allowed.join(', ') || 'none'}`)
      }
      if (updates.column === 'done' && (!task.log || task.log.length === 0)) {
        throw new Error('Cannot move to done: task has no log entries. Log your work first via POST /api/tasks/log')
      }
      columns[colId].splice(idx, 1)
      task.checked = updates.column === 'done'
      if (updates.column === 'inProgress' || updates.column === 'review' || updates.column === 'done') {
        task.date = new Date().toISOString().split('T')[0]
      }
      columns[updates.column].push(task)
    }

    writeTaskboard(columns)
  })
}

// ---------------------------------------------------------------------------
// Dependency helpers
// ---------------------------------------------------------------------------
export function setDependency(taskId: string, dependsOnId: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, taskId)
    if (!found) throw new Error(`Task not found: ${taskId}`)
    found.task.dependsOn = dependsOnId
    writeTaskboard(columns)
  })
}

export function clearDependency(taskId: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, taskId)
    if (!found) throw new Error(`Task not found: ${taskId}`)
    found.task.dependsOn = undefined
    writeTaskboard(columns)
  })
}

// ---------------------------------------------------------------------------
// Read all columns — used by continuation system
// ---------------------------------------------------------------------------
export function readAllColumns(): TaskColumns {
  const { columns } = readTaskboard()
  return columns
}

// ---------------------------------------------------------------------------
// Dispatch helpers — used by server.ts
// ---------------------------------------------------------------------------
export function getTodoTasks(): { columns: TaskColumns; todoTasks: Task[] } {
  const { columns } = readTaskboard()
  return { columns, todoTasks: [...columns.todo] }
}

export function moveTaskToInProgress(identifier: string, agentTag?: string): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const found = findTask(columns, identifier)
    if (!found) return
    if (found.colId !== 'todo') return

    const { task, colId, idx } = found
    columns[colId].splice(idx, 1)
    task.date = new Date().toISOString().split('T')[0]
    if (agentTag && !task.agent) task.agent = agentTag
    columns.inProgress.push(task)
    writeTaskboard(columns)
  })
}

export function reorderTasks(columnId: ColumnId, orderedIds: string[]): Promise<void> {
  return withTaskboardLock(() => {
    const { columns } = readTaskboard()
    const col = columns[columnId]
    const reordered = orderedIds.map(id => col.find(t => t.id === id)).filter(Boolean) as Task[]
    const missing = col.filter(t => !orderedIds.includes(t.id))
    columns[columnId] = [...reordered, ...missing]
    writeTaskboard(columns)
  })
}

export function getAgentTasks(agentId: string): Task[] {
  const { columns } = readTaskboard()
  return columns.todo.filter(t => t.agent === agentId)
}

export { KNOWN_AGENTS }
