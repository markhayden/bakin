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

// Explicit content-dir mocks (both the app facade and the package module —
// consumers import either path; see CLAUDE.md testing rules). BAKIN_HOME above
// covers env-time reads; these cover module-time resolver calls.
function testBakinPaths() {
  const assets = join(testHome, 'assets')
  return {
    home: testHome,
    memoryLog: join(testHome, 'MEMORY-LOG.md'),
    audit: join(testHome, 'audit.jsonl'),
    assets,
    'assets.store': join(assets, 'store'),
    'assets.inbox': join(assets, 'inbox'),
    'assets.trash': join(assets, '.trash'),
    agents: join(testHome, 'agents'),
    personas: join(testHome, 'team', 'personas'),
    team: join(testHome, 'team'),
    heartbeats: join(testHome, 'heartbeats'),
    inbox: join(testHome, 'inbox'),
    tasks: tasksDir,
    workflows: join(testHome, 'workflows'),
    settings: join(testHome, 'settings.json'),
    logs: join(testHome, 'logs'),
    antfly: join(testHome, 'antfly'),
    db: join(testHome, 'bakin.db'),
  }
}
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: testBakinPaths,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: testBakinPaths,
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

// Mock the workflow runtime to avoid cross-plugin dependency
mock.module('../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: mock(),
}))

// Spy on the dispatch registry abort — deleteTask imports the leaf
// dispatch-registry module statically (#604).
const abortTurnsForTaskSpy = mock((_taskId: string, _reason: string) => 0)
mock.module('../../src/core/dispatch-registry', () => ({
  abortTurnsForTask: abortTurnsForTaskSpy,
}))

// Spy hook registry — deleteTask owns the full workflow-instance cleanup
// (cancel + delete file) as the ONE canonical delete path (#604 T5).
const hookInvocations: Array<{ hook: string; data: Record<string, unknown> }> = []
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (hook: string, data: Record<string, unknown>) => {
      hookInvocations.push({ hook, data })
      return undefined
    },
    has: () => true,
    register: mock(),
  }),
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
  findTaskWithColumn,
  reorderTasks,
  renumberColumn,
  escalateTaskToReview,
  getSharedBakinTaskStore,
  moveTaskToInProgress,
  recoverTask,
  assignTaskToTeam,
  recordTeamResolution,
  archiveOldTasks,
  getTask,
  getTaskWithColumn,
  getTasksByAgent,
  VALID_TRANSITIONS,
  localDateString,
} from '@/core/task-store'
import { recordCompletion, hasCompletion } from '@/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearTaskStore()
  mock.clearAllMocks()
})

afterAll(() => {
  closeDb()
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

  it('stores and updates brandId (#419)', async () => {
    const task = await createTask(
      'Branded task', 'todo', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { brandId: 'acme' },
    )
    expect(task.brandId).toBe('acme')

    await updateTask(task.id, { brandId: 'other' })
    expect(getTask(task.id)?.brandId).toBe('other')
    await updateTask(task.id, { brandId: '' })
    expect(getTask(task.id)?.brandId).toBeUndefined()
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

// ---------------------------------------------------------------------------
// recoveries — the persisted auto-recovery counter (spec D3). Replaces counting
// 'Auto-recovered:' / 'Restart recovery:' log lines, which never reset.
// ---------------------------------------------------------------------------

describe('recoveries counter', () => {
  it('a new task starts at 0 in the file and in the view', async () => {
    const task = await createTask('Fresh', 'todo')
    expect(readRawTask(task.id).recoveries).toBe(0)
    expect(getTaskWithColumn(task.id)?.task.recoveries).toBe(0)
  })

  it('a legacy file without the field (and with old recovery log lines) reads as 0', async () => {
    const task = await createTask('Legacy', 'inProgress')
    const raw = readRawTask(task.id) as Partial<BakinTask>
    delete raw.recoveries
    raw.log = [
      { timestamp: '2026-10-15T14:21:31.276Z', author: 'watchdog', message: 'Auto-recovered: no agent heartbeat or task log for 32+ minutes. Moved back to Todo for re-dispatch.' },
      { timestamp: '2026-10-15T14:51:31.281Z', author: 'system', message: 'Restart recovery: no live run after server restart; returned to Todo for re-dispatch.' },
    ]
    writeFileSync(findTaskFile(task.id), JSON.stringify(raw, null, 2), 'utf-8')

    expect(getTaskWithColumn(task.id)?.task.recoveries).toBe(0)
  })

  it('recoverTask moves inProgress → todo and increments the counter in ONE write', async () => {
    const task = await createTask('Stranded', 'inProgress')
    const before = readRawTask(task.id).version ?? 0

    await recoverTask(task.id)

    const raw = readRawTask(task.id)
    expect(raw.column).toBe('todo')
    expect(raw.recoveries).toBe(1)
    expect(raw.version).toBe(before + 1)
    expect(getTaskWithColumn(task.id)).toMatchObject({ column: 'todo', task: { recoveries: 1 } })
  })

  it('recoverTask on a legacy file persists 1, not NaN', async () => {
    const task = await createTask('Legacy stranded', 'inProgress')
    const raw = readRawTask(task.id) as Partial<BakinTask>
    delete raw.recoveries
    writeFileSync(findTaskFile(task.id), JSON.stringify(raw, null, 2), 'utf-8')

    await recoverTask(task.id)
    expect(readRawTask(task.id).recoveries).toBe(1)
  })

  it('recoverTask refuses a transition the table forbids (a task already in todo), exactly like moveTask', async () => {
    const task = await createTask('Already queued', 'todo')
    await expect(recoverTask(task.id)).rejects.toThrow('Invalid transition')
    expect(readRawTask(task.id).recoveries).toBe(0)
  })

  it('an ordinary move never touches the counter', async () => {
    const task = await createTask('Counted', 'inProgress')
    await recoverTask(task.id)
    await moveTask(task.id, 'inProgress')
    expect(readRawTask(task.id).recoveries).toBe(1)
  })

  it('a human move with resetRecoveries writes the column AND recoveries 0 in one write', async () => {
    const task = await createTask('Retry me', 'inProgress')
    await recoverTask(task.id)
    await moveTask(task.id, 'inProgress')
    await recoverTask(task.id)
    expect(readRawTask(task.id).recoveries).toBe(2)
    const before = readRawTask(task.id).version ?? 0

    await moveTask(task.id, 'inProgress', undefined, 'human', { resetRecoveries: true })

    const raw = readRawTask(task.id)
    expect(raw.column).toBe('inProgress')
    expect(raw.recoveries).toBe(0)
    expect(raw.version).toBe(before + 1)
  })

  it('blocking never touches the counter', async () => {
    const task = await createTask('Block me', 'inProgress')
    await recoverTask(task.id)
    await blockTask(task.id, 'waiting', undefined, 'human')
    expect(readRawTask(task.id).recoveries).toBe(1)
  })
})

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

  it('rejects done → blocked for non-human callers', async () => {
    const task = await createTask('Done task', 'todo')
    await addTaskLog(task.id, 'pixel', 'Work done')
    await moveTask(task.id, 'done')

    await expect(blockTask(task.id, 'stale agent retry', 'agent-a')).rejects.toThrow('Invalid transition')
    expect(getTaskWithColumn(task.id)!.column).toBe('done')
  })

  it('re-blocking an already-blocked task is an idempotent reason update', async () => {
    const task = await createTask('Block me twice', 'todo')
    await blockTask(task.id, 'first reason', 'agent-a')
    await blockTask(task.id, 'second reason', 'agent-a')

    const result = getTaskWithColumn(task.id)
    expect(result!.column).toBe('blocked')
    expect(result!.task.blockedReason).toBe('second reason')
  })

  it('human channel bypasses the transition table, matching moveTask', async () => {
    const task = await createTask('Backlog item', 'backlog')
    // backlog → blocked is not in VALID_TRANSITIONS: agents are rejected...
    await expect(blockTask(task.id, 'nope', 'agent-a')).rejects.toThrow('Invalid transition')
    // ...but the operator can force it
    await blockTask(task.id, 'operator call', 'human', 'human')
    expect(getTaskWithColumn(task.id)!.column).toBe('blocked')
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

  it('aborts in-flight turns before removing state (#604)', async () => {
    const task = await createTask('Dispatched then deleted')
    abortTurnsForTaskSpy.mockClear()

    await deleteTask(task.id)

    expect(abortTurnsForTaskSpy).toHaveBeenCalledTimes(1)
    expect(abortTurnsForTaskSpy).toHaveBeenCalledWith(task.id, 'task-deleted')
    expect(getTask(task.id)).toBeNull()
  })

  it('owns the full workflow-instance cleanup: cancel then delete-file, by task id (#604 T5)', async () => {
    const task = await createTask('Workflow task to delete')
    hookInvocations.length = 0

    await deleteTask(task.id)

    const workflowHooks = hookInvocations.filter((h) => h.hook.startsWith('workflows.'))
    expect(workflowHooks.map((h) => h.hook)).toEqual(['workflows.cancelInstance', 'workflows.deleteInstance'])
    // Always the resolved task id — never a title identifier.
    expect(workflowHooks.every((h) => h.data.taskId === task.id)).toBe(true)
    expect(getTask(task.id)).toBeNull()
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

    expect(await clearDependency(child.id, parent.id)).toBe(true)
    found = getTask(child.id)
    expect(found!.dependsOn).toBeUndefined()
  })

  // Code review round 3: the settle park and continuation clear from a
  // snapshot; a dependency re-registered since must survive the clear.
  it('clearDependency clears only the dependency the caller saw — a replacement stays', async () => {
    const first = await createTask('First upstream')
    const second = await createTask('Second upstream')
    const child = await createTask('Child')
    await setDependency(child.id, first.id)
    await setDependency(child.id, second.id)

    expect(await clearDependency(child.id, first.id)).toBe(false)
    expect(getTask(child.id)!.dependsOn).toBe(second.id)
    expect(readRawTask(child.id).blockedBy).toEqual([second.id])

    expect(await clearDependency(child.id, second.id)).toBe(true)
    expect(getTask(child.id)!.dependsOn).toBeUndefined()
  })

  it('findTaskWithColumn resolves an id or a title, like the mutators', async () => {
    const task = await createTask('Write docs')
    expect(findTaskWithColumn(task.id)?.task.id).toBe(task.id)
    expect(findTaskWithColumn('Write docs')?.task.id).toBe(task.id)
    expect(findTaskWithColumn(task.id)?.column).toBe('todo')
    expect(findTaskWithColumn('ghost')).toBeNull()
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

describe('escalateTaskToReview (Health hand-over, spec D-G3)', () => {
  it('lands in Review from To Do or Done — the one exception to the agent transition table — and logs why', async () => {
    const todo = await createTask('stuck repair')
    expect(escalateTaskToReview(todo.id, 'Health: not fixed after 12h — handed back to you.')).toBe('todo')
    expect(getTaskWithColumn(todo.id)?.column).toBe('review')
    expect(getSharedBakinTaskStore().getSync(todo.id)!.log.at(-1)).toMatchObject({ author: 'health', message: expect.stringContaining('not fixed after 12h') })

    const done = await createTask('closed repair', 'done')
    expect(escalateTaskToReview(done.id, 'Health: this task was closed, but its incident still fails — reopened in Review for you.')).toBe('done')
    expect(getTaskWithColumn(done.id)?.column).toBe('review')
    // An agent move along the same edge is still refused.
    const other = await createTask('agent move')
    await expect(moveTask(other.id, 'review')).rejects.toThrow(/Invalid transition/)
  })

  it('a task already in Review just gets the log line', async () => {
    const t = await createTask('already there')
    await moveTask(t.id, 'inProgress')
    await moveTask(t.id, 'review')
    const before = getSharedBakinTaskStore().getSync(t.id)!.order
    expect(escalateTaskToReview(t.id, 'Health: not fixed after 12h — handed back to you.')).toBeNull()
    expect(getSharedBakinTaskStore().getSync(t.id)!).toMatchObject({ column: 'review', order: before })
  })

  it('a BLOCKED task moves to Review with its reason carried onto the log line (#896 review r6)', async () => {
    const t = await createTask('blocked repair')
    await moveTask(t.id, 'inProgress')
    await blockTask(t.id, 'installer hung at 40%')
    expect(escalateTaskToReview(t.id, 'Health: not fixed after 12h — handed back to you.')).toBe('blocked')
    const stored = getSharedBakinTaskStore().getSync(t.id)!
    expect(stored.column).toBe('review')
    expect(stored.blockedReason).toBeUndefined()
    expect(stored.log.at(-1)).toMatchObject({ author: 'health', message: 'Health: not fixed after 12h — handed back to you. (was blocked: installer hung at 40%)' })
  })
})

describe('reorderTasks — whole column', () => {
  const orderOf = (id: string) => getTask(id)?.order

  it('omitted and pending-delete tasks are renumbered after the listed ones, never left colliding', async () => {
    const hidden = await createTask('hidden') // order 0
    const omitted = await createTask('omitted') // order 1
    const listed = await createTask('listed') // order 2
    getSharedBakinTaskStore().markPendingDeleteSync(hidden.id, true)

    await reorderTasks('todo', [listed.id])

    expect(orderOf(listed.id)).toBe(0)
    getSharedBakinTaskStore().markPendingDeleteSync(hidden.id, false)
    const orders = readTaskboard().columns.todo.map((task) => task.order)
    expect(new Set(orders).size).toBe(3)
    expect([orderOf(hidden.id), orderOf(omitted.id)]).toEqual([1, 2])
  })

  it('ignores ids from a stale snapshot that are no longer in the column', async () => {
    const done = await createTask('already done', 'done') // done order 0
    const moved = await createTask('moved away') // todo order 0
    const stays = await createTask('stays') // todo order 1
    await moveTask(moved.id, 'inProgress')
    await addTaskLog(moved.id, 'agent-x', 'did it')
    await moveTask(moved.id, 'done') // done order 1

    await reorderTasks('todo', [moved.id, stays.id])

    expect(orderOf(moved.id)).toBe(1)
    expect(orderOf(done.id)).toBe(0)
    expect(orderOf(stays.id)).toBe(0)
  })

  it('renumberColumn keeps the visible order: newest first among duplicates, missing last', async () => {
    const first = await createTask('first', 'done')
    const dupOlder = await createTask('dup older', 'done')
    const dupNewer = await createTask('dup newer', 'done')
    const unordered = await createTask('unordered', 'done')
    // Legacy rows written on disk (rc.40 count rule): explicit timestamps so
    // "newest" is unambiguous.
    writeRawTask(first.id, { order: 0, updatedAt: '2026-10-18T10:00:00.000Z' })
    writeRawTask(dupOlder.id, { order: 6, updatedAt: '2026-10-18T11:00:00.000Z' })
    writeRawTask(dupNewer.id, { order: 6, updatedAt: '2026-10-18T12:00:00.000Z' })
    writeRawTask(unordered.id, { order: undefined, updatedAt: '2026-10-18T13:00:00.000Z' })
    const visibleBefore = readTaskboard().columns.done.map((task) => task.id)

    await renumberColumn('done')

    const after = readTaskboard().columns.done
    expect(after.map((task) => task.id)).toEqual(visibleBefore.filter((id) => id !== unordered.id).concat(unordered.id))
    expect(after.map((task) => task.order)).toEqual([0, 1, 2, 3])
    expect(after.slice(0, 3).map((task) => task.id)).toEqual([first.id, dupNewer.id, dupOlder.id])
  })

  it('writes only the tasks whose order changed', async () => {
    const a = await createTask('a')
    const b = await createTask('b')
    const versionA = getSharedBakinTaskStore().getSync(a.id)?.version

    await reorderTasks('todo', [a.id, b.id])

    expect(getSharedBakinTaskStore().getSync(a.id)?.version).toBe(versionA)
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

  it('purges ledger completion rows for deleted old tasks', async () => {
    const task = await createTask('Ancient done', 'todo')
    await addTaskLog(task.id, 'pixel', 'work')
    await moveTask(task.id, 'done')
    recordCompletion(task.id, { agent: 'pixel' })
    expect(hasCompletion(task.id)).toBe(true)

    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000)
    writeRawTask(task.id, { updatedAt: new Date(sixtyDaysAgo).toISOString() })

    expect(archiveOldTasks(30)).toBe(1)
    expect(hasCompletion(task.id)).toBe(false)
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
    await expect(clearDependency('ghost', 'other')).rejects.toThrow('Task not found')
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

  it('new task appends with order = max + 1', async () => {
    const t1 = await createTask('task-one', 'todo')
    const t2 = await createTask('task-two', 'todo')
    expect(t1.order).toBe(0)
    expect(t2.order).toBe(1)
  })

  it('a gap left by a delete never produces a duplicate order on the next create', async () => {
    const t1 = await createTask('keep-1', 'todo')
    const t2 = await createTask('drop', 'todo')
    const t3 = await createTask('keep-3', 'todo')
    expect([t1.order, t2.order, t3.order]).toEqual([0, 1, 2])
    await deleteTask(t2.id)
    const t4 = await createTask('after-gap', 'todo')
    // Count-based assignment would hand out 2 again (two tasks remain) and
    // collide with keep-3; max+1 hands out 3.
    expect(t4.order).toBe(3)
    const orders = readTaskboard().columns.todo.map((t) => t.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('a move into a column with a gap never duplicates an existing order', async () => {
    const a = await createTask('a', 'inProgress')
    const b = await createTask('b', 'inProgress')
    const c = await createTask('c', 'inProgress')
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2])
    await moveTask(b.id, 'done', 'inProgress', 'human')
    const d = await createTask('d', 'todo')
    await moveTask(d.id, 'inProgress', 'todo', 'human')
    expect(getTask(d.id)?.order).toBe(3)
    const orders = readTaskboard().columns.inProgress.map((t) => t.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('500 scripted creates/moves/deletes leave every column with unique orders', async () => {
    const columns = ['backlog', 'todo', 'inProgress', 'review', 'done', 'blocked'] as const
    const ids: string[] = []
    let seed = 7
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed }
    for (let i = 0; i < 500; i++) {
      const roll = next() % 10
      if (roll < 4 || ids.length === 0) {
        const t = await createTask(`churn-${i}`, columns[next() % columns.length])
        ids.push(t.id)
      } else if (roll < 8) {
        const id = ids[next() % ids.length]
        const to = columns[next() % columns.length]
        if (getTaskWithColumn(id)?.column !== to) await moveTask(id, to, undefined, 'human')
      } else {
        const idx = next() % ids.length
        await deleteTask(ids[idx])
        ids.splice(idx, 1)
      }
    }
    const board = readTaskboard()
    for (const column of columns) {
      const orders = board.columns[column].map((t) => t.order)
      expect(orders.every((o) => typeof o === 'number')).toBe(true)
      expect(new Set(orders).size).toBe(orders.length)
    }
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

// ---------------------------------------------------------------------------
// Team assignment (T1, #189)
//
// Invariant: `team` is the requested group, `agent` the concrete assignee.
// States: neither (unassigned) / agent only (direct) / team only (unresolved
// team task) / team+agent (resolved — the dispatch resolver fills agent and
// team is RETAINED for audit).
//
// Exclusion rules live in this app facade, not the raw store, because
// dispatch legitimately re-writes {agent} on resolved team tasks
// (moveTaskToInProgress) and must not erase the requested team:
//  - create: both assignee + team → reject
//  - update/assign: agent set to a DIFFERENT value than current → clears team
//  - update/assign: agent re-written with the SAME value → team retained
//  - update/assign: agent cleared → team retained (back to unresolved)
//  - team set → clears agent; both in one call → reject
//  - recordTeamResolution: writes agent, retains team (dispatch-only path)
// ---------------------------------------------------------------------------

describe('team assignment', () => {
  const teamOpts = { team: 'development' }
  const createTeamTask = () =>
    createTask('Team task', 'todo', undefined, undefined, undefined, undefined, undefined, undefined, undefined, teamOpts)

  it('createTask persists team and exposes it on the board view', async () => {
    const task = await createTeamTask()
    expect(task.team).toBe('development')
    expect(task.agent).toBeUndefined()
    expect(getTask(task.id)?.team).toBe('development')
  })

  it('createTask rejects assignee and team together', async () => {
    await expect(
      createTask('Bad', 'todo', 'dev-agent', undefined, undefined, undefined, undefined, undefined, undefined, teamOpts),
    ).rejects.toThrow(/both/i)
  })

  it('updateTask({team}) clears a direct agent assignment', async () => {
    const task = await createTask('T', 'todo', 'dev-agent')
    await updateTask(task.id, { team: 'development' })
    const after = getTask(task.id)
    expect(after?.team).toBe('development')
    expect(after?.agent).toBeUndefined()
  })

  it('updateTask rejects agent and team set together', async () => {
    const task = await createTask('T', 'todo')
    await expect(updateTask(task.id, { agent: 'dev-agent', team: 'development' })).rejects.toThrow(/both/i)
  })

  it('updateTask({agent}) to a different agent clears team (re-assignment intent)', async () => {
    const task = await createTeamTask()
    await updateTask(task.id, { agent: 'reviewer' })
    const after = getTask(task.id)
    expect(after?.agent).toBe('reviewer')
    expect(after?.team).toBeUndefined()
  })

  it('same-agent re-write retains team (dispatch move path)', async () => {
    const task = await createTeamTask()
    await recordTeamResolution(task.id, 'reviewer')
    await moveTaskToInProgress(task.id, 'reviewer')
    const after = getTask(task.id)
    expect(after?.agent).toBe('reviewer')
    expect(after?.team).toBe('development')
  })

  it('clearing agent retains team (back to unresolved)', async () => {
    const task = await createTeamTask()
    await recordTeamResolution(task.id, 'reviewer')
    await assignTask(task.id, '')
    const after = getTask(task.id)
    expect(after?.agent).toBeUndefined()
    expect(after?.team).toBe('development')
  })

  it('assignTask to a different agent clears team', async () => {
    const task = await createTeamTask()
    await recordTeamResolution(task.id, 'reviewer')
    await assignTask(task.id, 'architect')
    const after = getTask(task.id)
    expect(after?.agent).toBe('architect')
    expect(after?.team).toBeUndefined()
  })

  it('assignTaskToTeam sets team and clears any agent', async () => {
    const task = await createTask('T', 'todo', 'dev-agent')
    await assignTaskToTeam(task.id, 'development')
    const after = getTask(task.id)
    expect(after?.team).toBe('development')
    expect(after?.agent).toBeUndefined()
  })

  it('recordTeamResolution fills agent while retaining team', async () => {
    const task = await createTeamTask()
    await recordTeamResolution(task.id, 'reviewer')
    const after = getTask(task.id)
    expect(after?.agent).toBe('reviewer')
    expect(after?.team).toBe('development')
  })
})
