/**
 * Unit tests for task-store.ts — Bakin JSON-backed task store.
 * Points BAKIN_HOME at a temp directory so tests never touch real user data.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BakinTask } from '@bakin/core/tasks/store'

// ---------------------------------------------------------------------------
// Test directory setup — fake ~/.bakin/tasks/
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `bakin-task-store-test-${Date.now()}`)
const tasksDir = join(testHome, 'tasks')

process.env.BAKIN_HOME = testHome

mkdirSync(tasksDir, { recursive: true })

function clearTaskStore() {
  rmSync(tasksDir, { recursive: true, force: true })
  mkdirSync(tasksDir, { recursive: true })
}

function findTaskFile(taskId: string): string {
  for (const shard of readdirSync(tasksDir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue
    const file = join(tasksDir, shard.name, `task-${taskId}.json`)
    if (existsSync(file)) return file
  }
  throw new Error(`Task file not found: ${taskId}`)
}

function readRawTask(taskId: string): BakinTask {
  return JSON.parse(readFileSync(findTaskFile(taskId), 'utf-8')) as BakinTask
}

function writeRawTask(taskId: string, patch: Partial<BakinTask>) {
  const file = findTaskFile(taskId)
  const task = readRawTask(taskId)
  writeFileSync(file, JSON.stringify({ ...task, ...patch }, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

// Mock the workflow runtime to avoid cross-plugin dependency
mock.module('../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: mock(),
}))

// Suppress SSE broadcasts
;(globalThis as Record<string, unknown>).__bakinBroadcast = mock()

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  readTaskboard,
  createTask,
  moveTask,
  deleteTask,
  assignTask,
  addTaskLog,
  blockTask,
  updateTask,
  setDependency,
  clearDependency,
  reorderTasks,
  moveTaskToInProgress,
  archiveOldTasks,
  getTask,
  getTaskWithColumn,
  getTasksByAgent,
  VALID_TRANSITIONS,
  localDateString,
} from '@/core/task-store'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearTaskStore()
  mock.clearAllMocks()
})

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

describe('readTaskboard', () => {
  it('returns empty columns when no tasks exist', () => {
    const board = readTaskboard()
    expect(board.columns).toBeDefined()
    expect(board.columns.todo).toEqual([])
    expect(board.columns.inProgress).toEqual([])
    expect(board.columns.done).toEqual([])
  })

  it('groups tasks into correct columns', async () => {
    await createTask('Todo task', 'todo')
    await createTask('Backlog task', 'backlog')
    await createTask('In Progress task', 'inProgress')

    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(1)
    expect(board.columns.todo[0].title).toBe('Todo task')
    expect(board.columns.backlog).toHaveLength(1)
    expect(board.columns.backlog[0].title).toBe('Backlog task')
    expect(board.columns.inProgress).toHaveLength(1)
    expect(board.columns.inProgress[0].title).toBe('In Progress task')
  })
})

describe('getTask', () => {
  it('returns null for non-existent task', () => {
    expect(getTask('nonexistent')).toBeNull()
  })

  it('returns task by ID', async () => {
    const task = await createTask('Find me', 'todo')
    const found = getTask(task.id)
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Find me')
  })
})

describe('getTaskWithColumn', () => {
  it('returns task with column info', async () => {
    const task = await createTask('With column', 'todo')
    const result = getTaskWithColumn(task.id)
    expect(result).not.toBeNull()
    expect(result!.column).toBe('todo')
    expect(result!.task.title).toBe('With column')
  })
})

describe('getTasksByAgent', () => {
  it('filters tasks by agent', async () => {
    await createTask('Task A', 'todo', 'pixel')
    await createTask('Task B', 'todo', 'rolo')
    await createTask('Task C', 'todo', 'pixel')

    const pixelTasks = getTasksByAgent('pixel')
    expect(pixelTasks).toHaveLength(2)
    expect(pixelTasks.every(t => t.agent === 'pixel')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('creates a task with default column (todo)', async () => {
    const task = await createTask('New task')
    expect(task.id).toBeDefined()
    expect(task.id).toHaveLength(8)
    expect(task.title).toBe('New task')
    expect(task.checked).toBe(false)

    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(1)
  })

  it('creates a task in backlog', async () => {
    const task = await createTask('Backlog item', 'backlog')
    const board = readTaskboard()
    expect(board.columns.backlog).toHaveLength(1)
    expect(board.columns.backlog[0].id).toBe(task.id)
  })

  it('creates a task in inProgress with date', async () => {
    const task = await createTask('Active task', 'inProgress')
    expect(task.date).toBe(localDateString())
    const board = readTaskboard()
    expect(board.columns.inProgress).toHaveLength(1)
  })

  it('stores assignee, description, and metadata', async () => {
    const task = await createTask(
      'Full task', 'todo', 'pixel', 'A description', 'wf-123', 'main', undefined, 'parent-1', 'proj-abc'
    )
    expect(task.agent).toBe('pixel')
    expect(task.description).toBe('A description')
    expect(task.workflowId).toBe('wf-123')
    expect(task.createdBy).toBe('main')
    expect(task.parentId).toBe('parent-1')
    expect(task.projectId).toBe('proj-abc')
  })

  it('uses provided ID when given', async () => {
    const task = await createTask('Custom ID', 'todo', undefined, undefined, undefined, undefined, 'custom01')
    expect(task.id).toBe('custom01')
  })

  it('broadcasts SSE change', async () => {
    await createTask('Broadcast test')
    expect((globalThis as Record<string, unknown>).__bakinBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'taskboard' })
    )
  })
})

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

describe('moveTask', () => {
  it('moves task through valid transitions', async () => {
    const task = await createTask('Move me', 'todo')
    await addTaskLog(task.id, 'pixel', 'Did some work')
    await moveTask(task.id, 'inProgress')

    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(0)
    expect(board.columns.inProgress).toHaveLength(1)
    expect(board.columns.inProgress[0].date).toBe(localDateString())
  })

  it('rejects invalid transitions', async () => {
    const task = await createTask('Backlog item', 'backlog')
    await expect(moveTask(task.id, 'done')).rejects.toThrow('Invalid transition')
  })

  it('rejects move to done without log entries', async () => {
    const task = await createTask('No logs', 'todo')
    await expect(moveTask(task.id, 'done')).rejects.toThrow('no log entries')
  })

  it('allows move to done with log entries', async () => {
    const task = await createTask('Logged', 'todo')
    await addTaskLog(task.id, 'pixel', 'Did the work')
    await moveTask(task.id, 'done')

    const board = readTaskboard()
    expect(board.columns.done).toHaveLength(1)
    expect(board.columns.done[0].checked).toBe(true)
  })

  it('rejects invalid column name', async () => {
    await createTask('Bad col', 'todo')
    await expect(moveTask('Bad col', 'nonexistent')).rejects.toThrow('Invalid column')
  })

  it('rejects non-existent task', async () => {
    await expect(moveTask('ghost', 'done')).rejects.toThrow('Task not found')
  })

  it('moves tasks into review with date metadata', async () => {
    const task = await createTask('Review me', 'inProgress')
    await moveTask(task.id, 'review')

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('review')
    expect(result!.task.date).toBe(localDateString())
  })

  it('clears blocked fields when moving out of blocked', async () => {
    const task = await createTask('Block me', 'todo')
    await blockTask(task.id, 'Waiting on API')

    const blocked = getTaskWithColumn(task.id)
    expect(blocked!.column).toBe('blocked')

    await moveTask(task.id, 'todo')

    const result = getTask(task.id)!
    expect(result.blockedReason).toBeUndefined()
  })

  it('marks tasks checked and dated when moving to done', async () => {
    const task = await createTask('Complete me', 'todo')
    await addTaskLog(task.id, 'pixel', 'Work done')
    await moveTask(task.id, 'done')

    const result = getTask(task.id)!
    expect(result.checked).toBe(true)
    expect(result.date).toBe(localDateString())
  })

  it('moves done → archived', async () => {
    const task = await createTask('Confirm me', 'todo')
    await addTaskLog(task.id, 'pixel', 'Done')
    await moveTask(task.id, 'done')
    await moveTask(task.id, 'archived')

    const board = readTaskboard()
    expect(board.columns.archived).toHaveLength(1)
    expect(board.columns.archived[0].checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

describe('blockTask', () => {
  it('moves task to blocked with reason', async () => {
    const task = await createTask('Block me', 'todo')
    await blockTask(task.id, 'Waiting for access')

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('blocked')
    expect(result!.task.blockedReason).toBe('Waiting for access')
  })

  it('rejects non-existent task', async () => {
    await expect(blockTask('ghost', 'reason')).rejects.toThrow('Task not found')
  })
})

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------

describe('assignTask', () => {
  it('assigns an agent to a task', async () => {
    const task = await createTask('Assign me')
    await assignTask(task.id, 'pixel')

    const found = getTask(task.id)
    expect(found!.agent).toBe('pixel')
  })

  it('clears assignment with empty string', async () => {
    const task = await createTask('Unassign me', 'todo', 'pixel')
    await assignTask(task.id, '')

    const found = getTask(task.id)
    expect(found!.agent).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  it('removes a task', async () => {
    const task = await createTask('Delete me')
    await deleteTask(task.id)

    expect(getTask(task.id)).toBeNull()
    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(0)
  })

  it('rejects non-existent task', async () => {
    await expect(deleteTask('ghost')).rejects.toThrow('Task not found')
  })
})

// ---------------------------------------------------------------------------
// Task logs
// ---------------------------------------------------------------------------

describe('addTaskLog', () => {
  it('appends log entries', async () => {
    const task = await createTask('Log me')
    await addTaskLog(task.id, 'pixel', 'Started work')
    await addTaskLog(task.id, 'pixel', 'Finished work')

    const found = getTask(task.id)
    expect(found!.log).toHaveLength(2)
    expect(found!.log![0].author).toBe('pixel')
    expect(found!.log![0].message).toBe('Started work')
    expect(found!.log![1].message).toBe('Finished work')
  })

  it('includes ISO timestamp', async () => {
    const task = await createTask('Timestamp test')
    await addTaskLog(task.id, 'pixel', 'Check time')

    const found = getTask(task.id)
    expect(found!.log![0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('updates title and description', async () => {
    const task = await createTask('Original')
    await updateTask(task.id, { title: 'Updated', description: 'New desc' })

    const found = getTask(task.id)
    expect(found!.title).toBe('Updated')
    expect(found!.description).toBe('New desc')
  })

  it('updates agent', async () => {
    const task = await createTask('Reassign')
    await updateTask(task.id, { agent: 'rolo' })

    const found = getTask(task.id)
    expect(found!.agent).toBe('rolo')
  })

  it('updates column with transition validation', async () => {
    const task = await createTask('Move via update', 'todo')
    await addTaskLog(task.id, 'pixel', 'work')
    await updateTask(task.id, { column: 'inProgress' })

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('inProgress')
  })

  it('rejects invalid column transition', async () => {
    const task = await createTask('Bad transition', 'backlog')
    await expect(updateTask(task.id, { column: 'done' })).rejects.toThrow('Invalid transition')
  })

  it('clears description with empty string', async () => {
    const task = await createTask('With desc', 'todo', undefined, 'Has description')
    await updateTask(task.id, { description: '' })

    const found = getTask(task.id)
    expect(found!.description).toBeUndefined()
  })

  it('clears workflowId when caller passes explicit undefined', async () => {
    // Regression: createTaskWithEffects' workflow-failure cleanup path passes
    // `{ workflowId: undefined }` to roll back the workflow attachment. The
    // old `!== undefined` guard silently no-op'd this, leaving bogus
    // workflowIds attached forever.
    const task = await createTask('With workflow', 'todo', undefined, undefined, 'wf-original')
    expect(task.workflowId).toBe('wf-original')

    await updateTask(task.id, { workflowId: undefined })

    const found = getTask(task.id)
    expect(found!.workflowId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

describe('setDependency / clearDependency', () => {
  it('sets and clears a dependency', async () => {
    const parent = await createTask('Parent')
    const child = await createTask('Child')

    await setDependency(child.id, parent.id)
    let found = getTask(child.id)
    expect(found!.dependsOn).toBe(parent.id)

    await clearDependency(child.id)
    found = getTask(child.id)
    expect(found!.dependsOn).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe('reorderTasks', () => {
  it('reorders tasks within a column by updated_at', async () => {
    const t1 = await createTask('First')
    const t2 = await createTask('Second')
    const t3 = await createTask('Third')

    // Reverse the order
    await reorderTasks('todo', [t3.id, t2.id, t1.id])

    const board = readTaskboard()
    // Ordered by updated_at DESC — t3 should be first (highest updated_at)
    expect(board.columns.todo[0].id).toBe(t3.id)
    expect(board.columns.todo[1].id).toBe(t2.id)
    expect(board.columns.todo[2].id).toBe(t1.id)
  })
})

// ---------------------------------------------------------------------------
// moveTaskToInProgress
// ---------------------------------------------------------------------------

describe('moveTaskToInProgress', () => {
  it('moves a todo task to inProgress', async () => {
    const task = await createTask('Auto move', 'todo')
    await moveTaskToInProgress(task.id)

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('inProgress')
  })

  it('sets agent tag if provided and task is unassigned', async () => {
    const task = await createTask('Agent tag')
    await moveTaskToInProgress(task.id, 'pixel')

    const found = getTask(task.id)
    expect(found!.agent).toBe('pixel')
  })

  it('does not overwrite existing agent', async () => {
    const task = await createTask('Has agent', 'todo', 'rolo')
    await moveTaskToInProgress(task.id, 'pixel')

    const found = getTask(task.id)
    expect(found!.agent).toBe('rolo')
  })

  it('no-ops for non-todo tasks', async () => {
    const task = await createTask('In backlog', 'backlog')
    await moveTaskToInProgress(task.id)

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('backlog')
  })
})

// ---------------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------------

describe('archiveOldTasks', () => {
  it('deletes old completed tasks', async () => {
    const task = await createTask('Old task', 'todo')
    await addTaskLog(task.id, 'pixel', 'done')
    await moveTask(task.id, 'done')

    // Manually backdate updatedAt to 60 days ago
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000)
    writeRawTask(task.id, { updatedAt: new Date(sixtyDaysAgo).toISOString() })

    const count = archiveOldTasks(30)
    expect(count).toBe(1)
    expect(getTask(task.id)).toBeNull()
  })

  it('does not delete recent tasks', async () => {
    const task = await createTask('Recent task', 'todo')
    await addTaskLog(task.id, 'pixel', 'done')
    await moveTask(task.id, 'done')

    const count = archiveOldTasks(30)
    expect(count).toBe(0)
    expect(getTask(task.id)).not.toBeNull()
  })

  it('does not delete active (non-succeeded) tasks', async () => {
    const task = await createTask('Active task', 'inProgress')

    // Even if created long ago
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000)
    const timestamp = new Date(sixtyDaysAgo).toISOString()
    writeRawTask(task.id, { createdAt: timestamp, updatedAt: timestamp })

    const count = archiveOldTasks(30)
    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Title fallback lookup
// ---------------------------------------------------------------------------

describe('identifier resolution', () => {
  it('finds task by title when ID does not match', async () => {
    const task = await createTask('Find by title')
    await assignTask('Find by title', 'pixel')

    const found = getTask(task.id)
    expect(found!.agent).toBe('pixel')
  })
})

// ---------------------------------------------------------------------------
// Column mapping edge cases
// ---------------------------------------------------------------------------

describe('column mapping', () => {
  it('normalizes column names case-insensitively', async () => {
    await createTask('Case test', 'TODO')
    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(1)
  })

  it('handles in_progress alias', async () => {
    await createTask('Alias test', 'in_progress')
    const board = readTaskboard()
    expect(board.columns.inProgress).toHaveLength(1)
  })

  it('defaults to todo for invalid column', async () => {
    await createTask('Bad col', 'nonexistent')
    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('defines transitions for all 7 columns', () => {
    const columns = ['backlog', 'todo', 'inProgress', 'blocked', 'review', 'done', 'archived']
    for (const col of columns) {
      expect(VALID_TRANSITIONS[col as keyof typeof VALID_TRANSITIONS]).toBeDefined()
    }
  })

  it('backlog can only go to todo', () => {
    expect(VALID_TRANSITIONS.backlog).toEqual(['todo'])
  })
})

// ---------------------------------------------------------------------------
// Async error handling
// ---------------------------------------------------------------------------

describe('write operation error handling', () => {
  it('moveTask rejects on task not found', async () => {
    await expect(moveTask('ghost', 'done')).rejects.toThrow('Task not found')
  })

  it('deleteTask rejects on task not found', async () => {
    await expect(deleteTask('ghost')).rejects.toThrow('Task not found')
  })

  it('assignTask rejects on task not found', async () => {
    await expect(assignTask('ghost', 'pixel')).rejects.toThrow('Task not found')
  })

  it('addTaskLog rejects on task not found', async () => {
    await expect(addTaskLog('ghost', 'pixel', 'msg')).rejects.toThrow('Task not found')
  })

  it('blockTask rejects on task not found', async () => {
    await expect(blockTask('ghost', 'reason')).rejects.toThrow('Task not found')
  })

  it('updateTask rejects on task not found', async () => {
    await expect(updateTask('ghost', { title: 'nope' })).rejects.toThrow('Task not found')
  })

  it('setDependency rejects on task not found', async () => {
    await expect(setDependency('ghost', 'other')).rejects.toThrow('Task not found')
  })

  it('clearDependency rejects on task not found', async () => {
    await expect(clearDependency('ghost')).rejects.toThrow('Task not found')
  })
})

// ---------------------------------------------------------------------------
// Two-tier permissions (human vs agent channel)
// ---------------------------------------------------------------------------

describe('two-tier permissions', () => {
  it('human channel: any transition succeeds (backlog → done)', async () => {
    const task = await createTask('human-override', 'backlog')
    // backlog → done is NOT in VALID_TRANSITIONS, but human bypasses
    await moveTask(task.id, 'done', 'backlog', 'human')
    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')
  })

  it('human channel: no log entries needed for done', async () => {
    const task = await createTask('skip-logs', 'todo')
    // No log entries, but human can still move to done
    await moveTask(task.id, 'done', 'todo', 'human')
    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')
  })

  it('human channel: can move blocked → done directly', async () => {
    const task = await createTask('blocked-to-done', 'todo')
    await blockTask(task.id, 'test reason')
    // blocked → done is NOT in VALID_TRANSITIONS
    await moveTask(task.id, 'done', 'blocked', 'human')
    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')
  })

  it('agent channel: invalid transition rejected', async () => {
    const task = await createTask('agent-invalid', 'backlog')
    // backlog → done is NOT allowed for agents
    await expect(moveTask(task.id, 'done', 'backlog', 'mcp')).rejects.toThrow('Invalid transition')
  })

  it('agent channel: log entries required for done', async () => {
    const task = await createTask('agent-no-logs', 'todo')
    await moveTask(task.id, 'inProgress')
    // inProgress → done requires log entries for agents
    await expect(moveTask(task.id, 'done', 'inProgress', 'mcp')).rejects.toThrow('Cannot move to done')
  })

  it('no channel (default): enforces transition guard', async () => {
    const task = await createTask('no-channel', 'backlog')
    // No channel specified defaults to agent-grade guard enforcement.
    await expect(moveTask(task.id, 'done')).rejects.toThrow('Invalid transition')
  })

  it('human channel: updateTask column change bypasses guards', async () => {
    const task = await createTask('update-human', 'backlog')
    await updateTask(task.id, { column: 'done', channel: 'human' })
    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')
  })

  it('agent channel: updateTask column change enforces guards', async () => {
    const task = await createTask('update-agent', 'backlog')
    await expect(updateTask(task.id, { column: 'done', channel: 'mcp' })).rejects.toThrow('Invalid transition')
  })
})

// ---------------------------------------------------------------------------
// Order / ordering
// ---------------------------------------------------------------------------

describe('order-based ordering', () => {
  it('new task in empty column gets order 0', async () => {
    const task = await createTask('first-task', 'todo')
    expect(task.order).toBe(0)
  })

  it('new task appends with order = count', async () => {
    const t1 = await createTask('task-one', 'todo')
    const t2 = await createTask('task-two', 'todo')
    expect(t1.order).toBe(0)
    expect(t2.order).toBe(1)
  })

  it('tasks returned in order (ascending)', async () => {
    await createTask('first', 'todo')
    await createTask('second', 'todo')
    await createTask('third', 'todo')
    const board = readTaskboard()
    const titles = board.columns.todo.map(t => t.title)
    expect(titles).toEqual(['first', 'second', 'third'])
  })

  it('moveTask to different column assigns new order', async () => {
    const t = await createTask('movable', 'todo')
    await moveTask(t.id, 'inProgress')
    const result = getTaskWithColumn(t.id)
    expect(result?.column).toBe('inProgress')
    const task = getTask(t.id)
    expect(task?.order).toBe(0) // first in inProgress
  })

  it('moveTask always appends to end of target column', async () => {
    await createTask('anchor-1', 'todo')
    await createTask('anchor-2', 'todo')
    const t3 = await createTask('appended', 'backlog')
    await moveTask(t3.id, 'todo', 'backlog', 'human')
    const board = readTaskboard()
    const todoTitles = board.columns.todo.map(t => t.title)
    expect(todoTitles).toEqual(['anchor-1', 'anchor-2', 'appended'])
  })

  it('order preserved on non-move mutations (assign, log)', async () => {
    const t = await createTask('stable', 'todo')
    const originalOrder = t.order
    await assignTask(t.id, 'agent-x')
    await addTaskLog(t.id, 'agent-x', 'working on it')
    const task = getTask(t.id)
    expect(task?.order).toBe(originalOrder)
  })

  it('reorderTasks assigns clean zero-indexed order values', async () => {
    const t1 = await createTask('alpha', 'todo')
    const t2 = await createTask('beta', 'todo')
    const t3 = await createTask('gamma', 'todo')
    // Reverse order
    await reorderTasks('todo', [t3.id, t1.id, t2.id])
    const board = readTaskboard()
    const todoTitles = board.columns.todo.map(t => t.title)
    expect(todoTitles).toEqual(['gamma', 'alpha', 'beta'])
    // Verify zero-indexed order
    expect(board.columns.todo[0].order).toBe(0)
    expect(board.columns.todo[1].order).toBe(1)
    expect(board.columns.todo[2].order).toBe(2)
  })

  it('blockTask assigns order in blocked column', async () => {
    const t = await createTask('blockable', 'todo')
    await blockTask(t.id, 'waiting on API')
    const task = getTask(t.id)
    expect(task?.order).toBe(0) // first in blocked
  })

  it('concurrent creates get distinct contiguous orders', async () => {
    const t1 = await createTask('task-a', 'todo')
    const t2 = await createTask('task-b', 'todo')
    const t3 = await createTask('task-c', 'todo')
    const orders = [
      getTask(t1.id)?.order,
      getTask(t2.id)?.order,
      getTask(t3.id)?.order,
    ]
    expect(orders).toEqual([0, 1, 2])
  })
})
