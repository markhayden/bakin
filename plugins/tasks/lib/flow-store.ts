/**
 * SQLite-backed task store using OpenClaw's flow_runs table.
 *
 * Internal operations are synchronous (better-sqlite3's sync API).
 * Exported mutating functions return Promises for backward compatibility
 * with callers that chain .then() (workflow runtime, dispatch, etc.).
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { cancelInstance } from '../../workflows/lib/runtime'
import { generateTaskId } from './ids'
import type { Task, TaskColumns, TaskBoard, ColumnId, TaskLogEntry } from '../types'

// Re-export for convenience (consumers expect these from the store module)
export { generateTaskId } from './ids'

const BAKIN_OWNER_PREFIX = 'bakin:task:'

// ---------------------------------------------------------------------------
// Database access
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const dbPath = getOpenClawPath('flows', 'registry.sqlite')
  const dbDir = dirname(dbPath)
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  return db
}

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = openDb()
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function hasFlowRunsTable(db: Database.Database): boolean {
  const row = db.prepare(`
    SELECT 1 as present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'flow_runs'
  `).get() as { present?: number } | undefined
  return row?.present === 1
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

// Re-export valid transitions from constants (single source of truth)
export { VALID_TRANSITIONS } from '../constants'
import { VALID_TRANSITIONS } from '../constants'

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
  if (lower === 'archived' || lower === 'confirmed') return 'archived'
  if (lower === 'blocked') return 'blocked'
  return null
}

// ---------------------------------------------------------------------------
// flow_runs ↔ Bakin mapping
// ---------------------------------------------------------------------------

interface FlowRunRow {
  flow_id: string
  status: string
  goal: string
  state_json: string | null
  wait_json: string | null
  blocked_task_id: string | null
  blocked_summary: string | null
  current_step: string | null
  revision: number
  created_at: number
  updated_at: number
  ended_at: number | null
}

interface BakinTaskState {
  title: string
  agent?: string
  description?: string
  column?: 'backlog' | 'todo'
  dependsOn?: string
  parentId?: string
  createdBy?: string
  workflowId?: string
  projectId?: string
  scheduleJobId?: string
  archived?: boolean
  /** @deprecated Use `archived` — kept for backward compatibility with existing rows */
  confirmed?: boolean
  date?: string
  log?: TaskLogEntry[]
  order?: number
}

function getColumn(flow: FlowRunRow): ColumnId {
  const state = parseStateJson(flow.state_json)
  switch (flow.status) {
    case 'queued':
      return state.column === 'backlog' ? 'backlog' : 'todo'
    case 'running':
      return 'inProgress'
    case 'waiting':
      return flow.blocked_task_id ? 'blocked' : 'review'
    case 'succeeded':
      return (state.archived || state.confirmed) ? 'archived' : 'done'
    case 'failed':
    case 'cancelled':
      return 'done'
    default:
      return 'backlog'
  }
}

function parseStateJson(raw: string | null): BakinTaskState {
  if (!raw) return { title: '' }
  try { return JSON.parse(raw) } catch { return { title: '' } }
}

function flowToTask(flow: FlowRunRow): Task {
  const state = parseStateJson(flow.state_json)
  const column = getColumn(flow)
  return {
    id: flow.flow_id,
    title: state.title || flow.goal,
    agent: state.agent,
    createdBy: state.createdBy,
    checked: column === 'done' || column === 'archived',
    date: state.date,
    blockedReason: flow.blocked_summary || undefined,
    description: state.description,
    log: state.log,
    dependsOn: state.dependsOn,
    parentId: state.parentId,
    workflowId: state.workflowId,
    scheduleJobId: state.scheduleJobId,
    projectId: state.projectId,
    order: state.order,
    updatedAt: flow.updated_at,
  }
}

function emptyColumns(): TaskColumns {
  return { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] }
}

function flowsToBoard(flows: FlowRunRow[]): TaskBoard {
  const columns = emptyColumns()
  for (const flow of flows) {
    const col = getColumn(flow)
    columns[col].push(flowToTask(flow))
  }
  return { columns }
}

// ---------------------------------------------------------------------------
// Column → flow_runs field mapping (for writes)
// ---------------------------------------------------------------------------

function columnToStatus(col: ColumnId): string {
  switch (col) {
    case 'backlog':
    case 'todo':
      return 'queued'
    case 'inProgress':
      return 'running'
    case 'review':
    case 'blocked':
      return 'waiting'
    case 'done':
    case 'archived':
      return 'succeeded'
  }
}

// ---------------------------------------------------------------------------
// Order helpers
// ---------------------------------------------------------------------------

/**
 * Build a SQL WHERE clause fragment that matches tasks in a given column.
 * Mirrors the getColumn() logic using flow_runs fields.
 */
function getColumnWhereClause(col: ColumnId): string {
  const base = `owner_key LIKE 'bakin:task:%'`
  switch (col) {
    case 'backlog':
      return `${base} AND status = 'queued' AND json_extract(state_json, '$.column') = 'backlog'`
    case 'todo':
      return `${base} AND status = 'queued' AND (json_extract(state_json, '$.column') IS NULL OR json_extract(state_json, '$.column') != 'backlog')`
    case 'inProgress':
      return `${base} AND status = 'running'`
    case 'blocked':
      return `${base} AND status = 'waiting' AND blocked_task_id IS NOT NULL`
    case 'review':
      return `${base} AND status = 'waiting' AND (blocked_task_id IS NULL)`
    case 'done':
      return `${base} AND status IN ('succeeded', 'failed', 'cancelled') AND (json_extract(state_json, '$.archived') IS NULL OR json_extract(state_json, '$.archived') = false) AND (json_extract(state_json, '$.confirmed') IS NULL OR json_extract(state_json, '$.confirmed') = false)`
    case 'archived':
      return `${base} AND status = 'succeeded' AND (json_extract(state_json, '$.archived') = true OR json_extract(state_json, '$.confirmed') = true)`
  }
}

/**
 * Count tasks in a column. Used to assign order = count (append to end).
 */
function getColumnTaskCount(db: Database.Database, col: ColumnId): number {
  const where = getColumnWhereClause(col)
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM flow_runs WHERE ${where}`).get() as { cnt: number }
  return row.cnt
}

// ---------------------------------------------------------------------------
// SQL queries
// ---------------------------------------------------------------------------

const SELECT_ALL = `SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%' ORDER BY json_extract(state_json, '$.order') ASC, updated_at DESC`
const SELECT_BY_ID = `SELECT * FROM flow_runs WHERE flow_id = ? AND owner_key LIKE 'bakin:task:%'`

// ---------------------------------------------------------------------------
// Core read operations (synchronous)
// ---------------------------------------------------------------------------

export function readTaskboard(): TaskBoard {
  return withDb(db => {
    const rows = db.prepare(SELECT_ALL).all() as FlowRunRow[]
    return flowsToBoard(rows)
  })
}

// Alias for hook compatibility
export { readTaskboard as getAllTasks }

export function getTask(flowId: string): Task | null {
  return withDb(db => {
    const row = db.prepare(SELECT_BY_ID).get(flowId) as FlowRunRow | undefined
    return row ? flowToTask(row) : null
  })
}

export function getTaskWithColumn(flowId: string): { task: Task; column: ColumnId } | null {
  return withDb(db => {
    const row = db.prepare(SELECT_BY_ID).get(flowId) as FlowRunRow | undefined
    if (!row) return null
    return { task: flowToTask(row), column: getColumn(row) }
  })
}

export function getTasksByColumn(column: ColumnId): Task[] {
  const board = readTaskboard()
  return board.columns[column]
}

export function getTasksByAgent(agent: string): Task[] {
  return withDb(db => {
    const rows = db.prepare(
      `SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%' AND json_extract(state_json, '$.agent') = ?`
    ).all(agent) as FlowRunRow[]
    return rows.map(flowToTask)
  })
}

export function readAllColumns(): TaskColumns {
  return readTaskboard().columns
}

export function getTodoTasks(): { columns: TaskColumns; todoTasks: Task[] } {
  const { columns } = readTaskboard()
  return { columns, todoTasks: [...columns.todo] }
}

export function getAgentTasks(agentId: string): Task[] {
  return withDb(db => {
    const rows = db.prepare(
      `SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%' AND json_extract(state_json, '$.agent') = ? AND status = 'queued' AND json_extract(state_json, '$.column') != 'backlog'`
    ).all(agentId) as FlowRunRow[]
    return rows.map(flowToTask)
  })
}

// ---------------------------------------------------------------------------
// Find task by ID or title (ID preferred, title fallback)
// ---------------------------------------------------------------------------

function findFlowRow(db: Database.Database, identifier: string): FlowRunRow | null {
  // Try by ID first
  const byId = db.prepare(SELECT_BY_ID).get(identifier) as FlowRunRow | undefined
  if (byId) return byId

  // Fallback: title match
  const byTitle = db.prepare(
    `SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%' AND (goal = ? OR json_extract(state_json, '$.title') = ?)`
  ).get(identifier, identifier) as FlowRunRow | undefined
  return byTitle || null
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
    const flowId = id || generateTaskId()
    const colId = column ? (normalizeColumn(column) || 'todo') : 'todo'
    const now = Date.now()

    const state: BakinTaskState = {
      title,
      agent: assignee,
      description,
      createdBy,
      parentId,
      workflowId,
      projectId,
    }

    if (colId === 'backlog' || colId === 'todo') {
      state.column = colId
    }
    if (colId === 'inProgress' || colId === 'review' || colId === 'done' || colId === 'archived') {
      state.date = localDateString()
    }
    if (colId === 'done' || colId === 'archived') {
      state.archived = colId === 'archived' || undefined
    }

    const status = columnToStatus(colId)

    withDb(db => {
      state.order = getColumnTaskCount(db, colId)

      db.prepare(`
        INSERT INTO flow_runs (
          flow_id, shape, sync_mode, owner_key, requester_origin_json,
          controller_id, revision, status, notify_policy, goal,
          current_step, blocked_task_id, blocked_summary,
          state_json, wait_json, cancel_requested_at,
          created_at, updated_at, ended_at
        ) VALUES (
          ?, NULL, 'managed', ?, NULL,
          'bakin/tasks', 0, ?, 'silent', ?,
          NULL, NULL, NULL,
          ?, NULL, NULL,
          ?, ?, ?
        )
      `).run(
        flowId,
        BAKIN_OWNER_PREFIX + flowId,
        status,
        title,
        JSON.stringify(state),
        now,
        now,
        (colId === 'done' || colId === 'archived') ? now : null,
      )
    })

    broadcastChange()

    return Promise.resolve({
      id: flowId,
      title,
      agent: assignee,
      createdBy,
      checked: colId === 'done' || colId === 'archived',
      date: state.date,
      description,
      parentId,
      workflowId,
      projectId,
      order: state.order,
    })
  } catch (err) {
    return Promise.reject(err)
  }
}

export function moveTask(identifier: string, to: string, from?: string, channel?: string): Promise<void> {
  try {
    const toCol = normalizeColumn(to)
    if (!toCol) throw new Error(`Invalid column: ${to}`)

    const isHuman = channel === 'human'

    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      const currentCol = getColumn(flow)

      // State transition guard — human channel bypasses (operator can force any state)
      if (!isHuman) {
        const allowed = VALID_TRANSITIONS[currentCol]
        if (allowed && !allowed.includes(toCol)) {
          throw new Error(`Invalid transition: ${currentCol} → ${toCol}. Allowed: ${allowed.join(', ') || 'none'}`)
        }
      }

      const state = parseStateJson(flow.state_json)

      // Require at least one log entry before moving to done — human channel bypasses
      if (!isHuman && toCol === 'done' && (!state.log || state.log.length === 0)) {
        throw new Error('Cannot move to done: task has no log entries. Log your work first via bakin_exec_tasks_log_progress')
      }

      // Append to end of target column
      state.order = getColumnTaskCount(db, toCol)

      // Update state for new column
      const newStatus = columnToStatus(toCol)
      if (toCol === 'backlog' || toCol === 'todo') {
        state.column = toCol
      } else {
        delete state.column
      }
      if (toCol === 'inProgress' || toCol === 'review' || toCol === 'done' || toCol === 'archived') {
        state.date = localDateString()
      }
      state.archived = toCol === 'archived' ? true : undefined
      delete state.confirmed

      const now = Date.now()
      let waitJson: string | null = null

      if (toCol === 'review') {
        waitJson = JSON.stringify({ type: 'gate_approval', requestedAt: new Date().toISOString() })
      }

      const endedAt = (toCol === 'done' || toCol === 'archived') ? now : null

      // Clear blocked fields (blocked moves go through blockTask instead)
      const blockedTaskId = null
      const blockedSummary = null

      db.prepare(`
        UPDATE flow_runs SET
          status = ?,
          state_json = ?,
          wait_json = ?,
          blocked_task_id = ?,
          blocked_summary = ?,
          revision = revision + 1,
          updated_at = ?,
          ended_at = COALESCE(?, ended_at)
        WHERE flow_id = ?
      `).run(
        newStatus,
        JSON.stringify(state),
        waitJson,
        blockedTaskId,
        blockedSummary,
        now,
        endedAt,
        flow.flow_id,
      )

      // Cancel active workflow instances when task leaves in-progress
      if ((toCol === 'done' || toCol === 'blocked') && currentCol === 'inProgress') {
        try { cancelInstance(flow.flow_id) } catch { /* best effort */ }
      }
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function assignTask(identifier: string, agent: string): Promise<void> {
  try {
    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      const state = parseStateJson(flow.state_json)
      state.agent = agent || undefined

      db.prepare(`
        UPDATE flow_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE flow_id = ?
      `).run(JSON.stringify(state), Date.now(), flow.flow_id)
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function deleteTask(identifier: string): Promise<void> {
  try {
    const flowId = withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      db.prepare(`DELETE FROM flow_runs WHERE flow_id = ?`).run(flow.flow_id)
      return flow.flow_id
    })

    // Cancel any active workflow instances
    try { cancelInstance(flowId) } catch { /* best effort */ }

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function addTaskLog(identifier: string, author: string, message: string): Promise<void> {
  try {
    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      const state = parseStateJson(flow.state_json)
      if (!state.log) state.log = []
      state.log.push({ timestamp: new Date().toISOString(), author, message })

      db.prepare(`
        UPDATE flow_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE flow_id = ?
      `).run(JSON.stringify(state), Date.now(), flow.flow_id)
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function blockTask(identifier: string, reason: string, agent?: string): Promise<void> {
  try {
    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      const state = parseStateJson(flow.state_json)
      state.date = undefined
      delete state.column
      state.order = getColumnTaskCount(db, 'blocked')

      const now = Date.now()

      // blocked_task_id = 'blocked' is a sentinel value to distinguish blocked from review
      // (both map to status = 'waiting'; getColumn() checks blocked_task_id truthiness)
      db.prepare(`
        UPDATE flow_runs SET
          status = 'waiting',
          state_json = ?,
          wait_json = NULL,
          blocked_task_id = ?,
          blocked_summary = ?,
          revision = revision + 1,
          updated_at = ?
        WHERE flow_id = ?
      `).run(
        JSON.stringify(state),
        'blocked',
        reason,
        now,
        flow.flow_id,
      )
    })

    broadcastChange()
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
    const isHuman = updates.channel === 'human'

    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) throw new Error(`Task not found: ${identifier}`)

      const state = parseStateJson(flow.state_json)
      const currentCol = getColumn(flow)

      if (updates.title !== undefined) {
        state.title = updates.title
      }
      if (updates.description !== undefined) {
        state.description = updates.description || undefined
      }
      if (updates.agent !== undefined) {
        state.agent = updates.agent || undefined
      }
      if (updates.workflowId !== undefined) {
        state.workflowId = updates.workflowId || undefined
      }
      if (updates.projectId !== undefined) {
        state.projectId = updates.projectId || undefined
      }

      let newStatus = flow.status
      let waitJson = flow.wait_json
      let blockedTaskId = flow.blocked_task_id
      let blockedSummary = flow.blocked_summary
      let endedAt = flow.ended_at

      if (updates.column !== undefined && updates.column !== currentCol) {
        if (!isHuman) {
          const allowed = VALID_TRANSITIONS[currentCol]
          if (allowed && !allowed.includes(updates.column)) {
            throw new Error(`Invalid transition: ${currentCol} → ${updates.column}. Allowed: ${allowed.join(', ') || 'none'}`)
          }
        }
        if (!isHuman && updates.column === 'done' && (!state.log || state.log.length === 0)) {
          throw new Error('Cannot move to done: task has no log entries. Log your work first via bakin_exec_tasks_log_progress')
        }

        newStatus = columnToStatus(updates.column)
        state.order = getColumnTaskCount(db, updates.column)
        if (updates.column === 'backlog' || updates.column === 'todo') {
          state.column = updates.column
        } else {
          delete state.column
        }
        if (updates.column === 'inProgress' || updates.column === 'review' || updates.column === 'done' || updates.column === 'archived') {
          state.date = localDateString()
        }
        state.archived = updates.column === 'archived' ? true : undefined
        delete state.confirmed

        if (updates.column !== 'blocked') {
          blockedTaskId = null
          blockedSummary = null
        }
        if (updates.column !== 'review') {
          waitJson = null
        }
        if (updates.column === 'done' || updates.column === 'archived') {
          endedAt = Date.now()
        }
      }

      const goal = updates.title || state.title || flow.goal

      db.prepare(`
        UPDATE flow_runs SET
          status = ?,
          goal = ?,
          state_json = ?,
          wait_json = ?,
          blocked_task_id = ?,
          blocked_summary = ?,
          revision = revision + 1,
          updated_at = ?,
          ended_at = ?
        WHERE flow_id = ?
      `).run(
        newStatus,
        goal,
        JSON.stringify(state),
        waitJson,
        blockedTaskId,
        blockedSummary,
        Date.now(),
        endedAt,
        flow.flow_id,
      )
    })

    broadcastChange()
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
    withDb(db => {
      const flow = findFlowRow(db, taskId)
      if (!flow) throw new Error(`Task not found: ${taskId}`)

      const state = parseStateJson(flow.state_json)
      state.dependsOn = dependsOnId

      db.prepare(`
        UPDATE flow_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE flow_id = ?
      `).run(JSON.stringify(state), Date.now(), flow.flow_id)
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function clearDependency(taskId: string): Promise<void> {
  try {
    withDb(db => {
      const flow = findFlowRow(db, taskId)
      if (!flow) throw new Error(`Task not found: ${taskId}`)

      const state = parseStateJson(flow.state_json)
      delete state.dependsOn

      db.prepare(`
        UPDATE flow_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE flow_id = ?
      `).run(JSON.stringify(state), Date.now(), flow.flow_id)
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

// ---------------------------------------------------------------------------
// Reorder / dispatch helpers
// ---------------------------------------------------------------------------

export function reorderTasks(columnId: ColumnId, orderedIds: string[]): Promise<void> {
  try {
    withDb(db => {
      const stmt = db.prepare(`
        UPDATE flow_runs SET
          state_json = json_set(state_json, '$.order', ?),
          revision = revision + 1,
          updated_at = ?
        WHERE flow_id = ? AND owner_key LIKE 'bakin:task:%'
      `)
      const now = Date.now()
      const reorder = db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          stmt.run(i, now, orderedIds[i])
        }
      })
      reorder()
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function moveTaskToInProgress(identifier: string, agentTag?: string): Promise<void> {
  try {
    withDb(db => {
      const flow = findFlowRow(db, identifier)
      if (!flow) return
      if (getColumn(flow) !== 'todo') return

      const state = parseStateJson(flow.state_json)
      state.date = localDateString()
      if (agentTag && !state.agent) state.agent = agentTag
      delete state.column
      state.order = getColumnTaskCount(db, 'inProgress')

      db.prepare(`
        UPDATE flow_runs SET
          status = 'running',
          state_json = ?,
          revision = revision + 1,
          updated_at = ?
        WHERE flow_id = ?
      `).run(JSON.stringify(state), Date.now(), flow.flow_id)
    })

    broadcastChange()
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

// ---------------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------------

export function archiveOldTasks(olderThanDays: number): number {
  return withDb(db => {
    if (!hasFlowRunsTable(db)) return 0
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)
    const result = db.prepare(`
      DELETE FROM flow_runs
      WHERE owner_key LIKE 'bakin:task:%'
      AND status IN ('succeeded', 'failed', 'cancelled')
      AND ended_at IS NOT NULL
      AND ended_at < ?
    `).run(cutoff)
    return result.changes
  })
}

export function getArchivedCount(): number {
  return 0
}

/**
 * Move done tasks older than `olderThanMs` to the archived column.
 * Sets state.archived = true on succeeded rows whose ended_at is past the cutoff.
 * Returns the number of tasks archived.
 */
export function autoArchiveDoneTasks(olderThanMs: number = 24 * 60 * 60 * 1000): number {
  return withDb(db => {
    if (!hasFlowRunsTable(db)) return 0
    const cutoff = Date.now() - olderThanMs
    // Find succeeded tasks that are in the "done" column (no archived/confirmed flag)
    const rows = db.prepare(`
      SELECT flow_id, state_json FROM flow_runs
      WHERE owner_key LIKE 'bakin:task:%'
      AND status = 'succeeded'
      AND ended_at IS NOT NULL
      AND ended_at < ?
      AND json_extract(state_json, '$.archived') IS NULL
      AND json_extract(state_json, '$.confirmed') IS NULL
    `).all(cutoff) as Array<{ flow_id: string; state_json: string | null }>

    if (rows.length === 0) return 0

    const stmt = db.prepare(`
      UPDATE flow_runs SET state_json = ?, revision = revision + 1, updated_at = ? WHERE flow_id = ?
    `)
    const now = Date.now()
    let nextOrder = getColumnTaskCount(db, 'archived')
    const tx = db.transaction(() => {
      for (const row of rows) {
        const state = parseStateJson(row.state_json)
        state.archived = true
        delete state.confirmed
        state.order = nextOrder
        nextOrder++
        stmt.run(JSON.stringify(state), now, row.flow_id)
      }
    })
    tx()

    if (rows.length > 0) broadcastChange()
    return rows.length
  })
}
