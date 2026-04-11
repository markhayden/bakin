/**
 * Tests for tasks plugin routes and exec tools.
 * Validates all REST API endpoints and MCP exec tools registered by the plugin.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import type { APIRoute, ExecToolDefinition } from '../../../src/lib/plugin-types'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
  makeRequest,
  type ActivatedPlugin,
} from '../test-helpers'

// ─── Mocks ─────────────────────────────────────────────────────────────────

const testDir = join(process.cwd(), 'test-content-tasks-routes')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/lib/content', () => ({
  readContentFile: vi.fn(() => null),
  writeContentFile: vi.fn(),
}))

vi.mock('../../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: vi.fn(),
}))

// Mock taskboard functions
const mockReadTaskboard = vi.fn()
const mockCreateTask = vi.fn()
const mockDeleteTask = vi.fn()
const mockAssignTask = vi.fn()
const mockAddTaskLog = vi.fn()
const mockBlockTask = vi.fn()
const mockUpdateTask = vi.fn()
const mockMoveTask = vi.fn()
const mockSetDependency = vi.fn()
const mockClearDependency = vi.fn()
const mockReorderTasks = vi.fn()

vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: (...args: unknown[]) => mockReadTaskboard(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  assignTask: (...args: unknown[]) => mockAssignTask(...args),
  addTaskLog: (...args: unknown[]) => mockAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockBlockTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  moveTask: (...args: unknown[]) => mockMoveTask(...args),
  setDependency: (...args: unknown[]) => mockSetDependency(...args),
  clearDependency: (...args: unknown[]) => mockClearDependency(...args),
  reorderTasks: (...args: unknown[]) => mockReorderTasks(...args),
  autoArchiveDoneTasks: vi.fn().mockReturnValue(0),
  archiveOldTasks: vi.fn().mockReturnValue(0),
}))

// Mock task-service functions
const mockMoveTaskWithEffects = vi.fn()
const mockBlockTaskWithEffects = vi.fn()
const mockCreateTaskWithEffects = vi.fn()
const mockReportComplete = vi.fn()
const mockSetDependencyWithEffects = vi.fn()
const mockGetTaskDetails = vi.fn()
const mockLogProgress = vi.fn()
const mockTriggerDispatch = vi.fn()

vi.mock('../../../src/core/task-service', () => ({
  moveTaskWithEffects: (...args: unknown[]) => mockMoveTaskWithEffects(...args),
  blockTaskWithEffects: (...args: unknown[]) => mockBlockTaskWithEffects(...args),
  createTaskWithEffects: (...args: unknown[]) => mockCreateTaskWithEffects(...args),
  reportComplete: (...args: unknown[]) => mockReportComplete(...args),
  setDependencyWithEffects: (...args: unknown[]) => mockSetDependencyWithEffects(...args),
  getTaskDetails: (...args: unknown[]) => mockGetTaskDetails(...args),
  logProgress: (...args: unknown[]) => mockLogProgress(...args),
  triggerDispatch: (...args: unknown[]) => mockTriggerDispatch(...args),
}))

// ─── Setup ─────────────────────────────────────────────────────────────────

let activated: ActivatedPlugin

beforeAll(async () => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }
  const plugin = (await import('../../../plugins/tasks')).default
  activated = await activatePlugin(plugin, testDir)
})

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true })
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Route Registration ────────────────────────────────────────────────────

describe('Tasks Plugin — Route Registration', () => {
  it('registers 13 routes', () => {
    expect(activated.routes.length).toBe(13)
  })

  it.each([
    ['GET', '/'],
    ['GET', '/:taskId'],
    ['POST', '/'],
    ['PUT', '/:taskId'],
    ['DELETE', '/:taskId'],
    ['POST', '/:taskId/move'],
    ['POST', '/:taskId/assign'],
    ['POST', '/:taskId/log'],
    ['POST', '/:taskId/block'],
    ['POST', '/:taskId/dependency'],
    ['POST', '/reorder'],
  ])('registers %s %s', (method, path) => {
    expect(findRoute(activated.routes, method, path)).toBeDefined()
  })
})

// ─── GET / — List Tasks ────────────────────────────────────────────────────

describe('GET / — List Tasks', () => {
  it('returns the full taskboard', async () => {
    const board = { columns: { todo: [{ id: 't1', title: 'Test' }] } }
    mockReadTaskboard.mockResolvedValue(board)

    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(200)
    expect(body).toEqual(board)
  })

  it('returns 500 on error', async () => {
    mockReadTaskboard.mockRejectedValue(new Error('read failed'))

    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(500)
    expect(body.error).toContain('read failed')
  })
})

// ─── GET /:taskId — Get Task ───────────────────────────────────────────────

describe('GET /:taskId — Get Task', () => {
  it('returns task details', async () => {
    const details = { task: { id: 'abc123', title: 'My Task' }, column: 'todo' }
    mockGetTaskDetails.mockResolvedValue(details)

    const route = findRoute(activated.routes, 'GET', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'abc123' },
    })

    expect(status).toBe(200)
    expect(body.task).toEqual(details.task)
    expect(mockGetTaskDetails).toHaveBeenCalledWith('abc123')
  })

  it('returns 400 when taskId is missing', async () => {
    const route = findRoute(activated.routes, 'GET', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(400)
    expect(body.error).toBe('taskId required')
  })

  it('returns 404 when task not found', async () => {
    mockGetTaskDetails.mockResolvedValue(null)

    const route = findRoute(activated.routes, 'GET', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'nonexistent' },
    })

    expect(status).toBe(404)
    expect(body.error).toBe('Task not found')
  })
})

// ─── POST / — Create Task ──────────────────────────────────────────────────

describe('POST / — Create Task', () => {
  it('creates a task and returns id', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-1', workflowId: 'wf-1' })

    const route = findRoute(activated.routes, 'POST', '/')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { title: 'New Task', column: 'todo', createdBy: 'pixel' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.id).toBe('new-1')
    expect(body.workflowId).toBe('wf-1')
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Task',
        column: 'todo',
        createdBy: 'pixel',
        channel: 'rest',
      })
    )
    expect(activated.ctx.activity.log).toHaveBeenCalled()
  })

  it('returns 400 when title is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { column: 'todo' },
    })

    expect(status).toBe(400)
    expect(body.error).toBe('title required')
  })

  it('defaults createdBy to system', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-2' })

    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { title: 'No author task' },
    })

    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'system' })
    )
  })

  it('returns 500 on creation error', async () => {
    mockCreateTaskWithEffects.mockRejectedValue(new Error('create failed'))

    const route = findRoute(activated.routes, 'POST', '/')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { title: 'Bad Task' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('create failed')
  })
})

// ─── PUT /:taskId — Update Task ────────────────────────────────────────────

describe('PUT /:taskId — Update Task', () => {
  it('updates a task by taskId', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { title: 'Updated Title', agent: 'pixel' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ title: 'Updated Title' }))
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith('updated', 'pixel', { taskId: 'task-1' })
  })

  it('falls back to body.id when taskId param is missing', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { id: 'task-from-body', title: 'Updated' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-from-body', expect.anything())
  })

  it('returns 400 when no identifier is provided', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { title: 'No ID' },
    })

    expect(status).toBe(400)
    expect(body.error).toBe('taskId required')
  })

  it('returns 500 on update error', async () => {
    mockUpdateTask.mockRejectedValue(new Error('update failed'))

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { title: 'Fail' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('update failed')
  })
})

// ─── DELETE /:taskId — Delete Task ─────────────────────────────────────────

describe('DELETE /:taskId — Delete Task', () => {
  it('deletes a task by taskId', async () => {
    mockDeleteTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-del' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDeleteTask).toHaveBeenCalledWith('task-del')
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith('deleted', 'system', { taskId: 'task-del' })
  })

  it('returns 400 when no identifier is provided', async () => {
    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(400)
    expect(body.error).toBe('taskId required')
  })

  it('returns 500 on delete error', async () => {
    mockDeleteTask.mockRejectedValue(new Error('delete failed'))

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-del' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('delete failed')
  })
})

// ─── POST /:taskId/move — Move Task ───────────────────────────────────────

describe('POST /:taskId/move — Move Task', () => {
  it('moves a task to a new column', async () => {
    mockMoveTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-mv' },
      body: { to: 'review', agent: 'pixel' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-mv', 'review', 'pixel', {
      from: undefined, channel: 'rest',
    })
  })

  it('returns 400 when to is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-mv' },
      body: { agent: 'pixel' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('to required')
  })

  it('returns 400 when agent is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-mv' },
      body: { to: 'review' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('agent field required')
  })

  it('returns 403 for workflow-blocked moves', async () => {
    mockMoveTaskWithEffects.mockRejectedValue(new Error('Workflow tasks cannot be moved manually'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-wf' },
      body: { to: 'done', agent: 'pixel' },
    })

    expect(status).toBe(403)
    expect(body.error).toContain('Workflow tasks cannot be moved')
  })

  it('returns 500 for other move errors', async () => {
    mockMoveTaskWithEffects.mockRejectedValue(new Error('unexpected failure'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-mv' },
      body: { to: 'done', agent: 'pixel' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('unexpected failure')
  })

  it('passes human channel through to moveTaskWithEffects', async () => {
    mockMoveTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-pos' },
      body: { to: 'inProgress', agent: 'human', channel: 'human' },
    })

    expect(status).toBe(200)
    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-pos', 'inProgress', 'human', {
      from: undefined, channel: 'human',
    })
  })

  it('returns 400 when moving to blocked without reason', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { to: 'blocked', agent: 'human' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('reason required when moving to blocked')
  })

  it('calls blockTaskWithEffects with reason when moving to blocked', async () => {
    mockBlockTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { to: 'blocked', agent: 'human', channel: 'human', reason: 'waiting on API' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockBlockTaskWithEffects).toHaveBeenCalledWith('task-blk', 'waiting on API', 'human', 'human')
  })

  it('defaults channel to rest when not provided', async () => {
    mockMoveTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-def' },
      body: { to: 'review', agent: 'pixel' },
    })

    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-def', 'review', 'pixel', expect.objectContaining({
      channel: 'rest',
    }))
  })

  it('rejects channel=human when agent is not human (prevents agent impersonation)', async () => {
    mockMoveTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-imp' },
      body: { to: 'done', agent: 'pixel', channel: 'human' },
    })

    // channel should be downgraded to 'rest' since agent !== 'human'
    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-imp', 'done', 'pixel', expect.objectContaining({
      channel: 'rest',
    }))
  })
})

// ─── POST /:taskId/assign — Assign Task ───────────────────────────────────

describe('POST /:taskId/assign — Assign Task', () => {
  it('assigns a task to an agent', async () => {
    mockAssignTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-a' },
      body: { agent: 'rolo' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockAssignTask).toHaveBeenCalledWith('task-a', 'rolo')
  })

  it('unassigns when agent is empty', async () => {
    mockAssignTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-a' },
      body: {},
    })

    expect(mockAssignTask).toHaveBeenCalledWith('task-a', '')
  })

  it('returns 400 when taskId is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { agent: 'rolo' },
    })

    expect(status).toBe(400)
    expect(body.error).toBe('taskId required')
  })

  it('returns 500 on assign error', async () => {
    mockAssignTask.mockRejectedValue(new Error('assign failed'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-a' },
      body: { agent: 'rolo' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('assign failed')
  })
})

// ─── POST /:taskId/log — Add Log Entry ────────────────────────────────────

describe('POST /:taskId/log — Add Log Entry', () => {
  it('adds a log entry to a task', async () => {
    mockLogProgress.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/log')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-log' },
      body: { message: 'Made progress', author: 'pixel' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockLogProgress).toHaveBeenCalledWith('task-log', 'pixel', 'Made progress', 'rest')
  })

  it('defaults author to system', async () => {
    mockLogProgress.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/log')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-log' },
      body: { message: 'Auto log' },
    })

    expect(mockLogProgress).toHaveBeenCalledWith('task-log', 'system', 'Auto log', 'rest')
  })

  it('returns 400 when message is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/log')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-log' },
      body: { author: 'pixel' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('message required')
  })

  it('returns 400 when taskId is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/log')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { message: 'orphan log' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('taskId')
  })

  it('returns 500 on log error', async () => {
    mockLogProgress.mockRejectedValue(new Error('log failed'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/log')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-log' },
      body: { message: 'fail', author: 'pixel' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('log failed')
  })
})

// ─── POST /:taskId/block — Block Task ─────────────────────────────────────

describe('POST /:taskId/block — Block Task', () => {
  it('blocks a task with reason', async () => {
    mockBlockTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/block')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { reason: 'waiting on API key', agent: 'trainer' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockBlockTaskWithEffects).toHaveBeenCalledWith('task-blk', 'waiting on API key', 'trainer', 'rest')
  })

  it('defaults agent to system', async () => {
    mockBlockTaskWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/block')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { reason: 'blocked reason' },
    })

    expect(mockBlockTaskWithEffects).toHaveBeenCalledWith('task-blk', 'blocked reason', 'system', 'rest')
  })

  it('returns 400 when reason is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/block')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { agent: 'trainer' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('reason required')
  })

  it('returns 500 on block error', async () => {
    mockBlockTaskWithEffects.mockRejectedValue(new Error('block failed'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/block')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-blk' },
      body: { reason: 'fail', agent: 'trainer' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('block failed')
  })
})

// ─── POST /:taskId/dependency — Set Dependency ────────────────────────────

describe('POST /:taskId/dependency — Set Dependency', () => {
  it('sets a dependency between tasks', async () => {
    mockSetDependencyWithEffects.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/dependency')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-dep' },
      body: { dependsOn: 'task-parent' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockSetDependencyWithEffects).toHaveBeenCalledWith('task-dep', 'task-parent', 'rest')
  })

  it('returns 400 when dependsOn is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/dependency')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-dep' },
      body: {},
    })

    expect(status).toBe(400)
    expect(body.error).toContain('dependsOn required')
  })

  it('returns 500 on dependency error', async () => {
    mockSetDependencyWithEffects.mockRejectedValue(new Error('dep failed'))

    const route = findRoute(activated.routes, 'POST', '/:taskId/dependency')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-dep' },
      body: { dependsOn: 'task-parent' },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('dep failed')
  })
})

// ─── POST /reorder — Reorder Tasks ────────────────────────────────────────

describe('POST /reorder — Reorder Tasks', () => {
  it('reorders tasks in a column', async () => {
    mockReorderTasks.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/reorder')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { columnId: 'todo', orderedIds: ['t1', 't2', 't3'] },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockReorderTasks).toHaveBeenCalledWith('todo', ['t1', 't2', 't3'])
  })

  it('returns 400 when columnId is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/reorder')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { orderedIds: ['t1'] },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('columnId')
  })

  it('returns 400 when orderedIds is not an array', async () => {
    const route = findRoute(activated.routes, 'POST', '/reorder')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { columnId: 'todo', orderedIds: 'not-array' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('orderedIds')
  })

  it('returns 500 on reorder error', async () => {
    mockReorderTasks.mockRejectedValue(new Error('reorder failed'))

    const route = findRoute(activated.routes, 'POST', '/reorder')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { columnId: 'todo', orderedIds: ['t1'] },
    })

    expect(status).toBe(500)
    expect(body.error).toContain('reorder failed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Exec Tools
// ═══════════════════════════════════════════════════════════════════════════

describe('Tasks Plugin — Exec Tool Registration', () => {
  it('registers 11 exec tools', () => {
    expect(activated.execTools.length).toBe(11)
  })

  it.each([
    'bakin_exec_tasks_list',
    'bakin_exec_tasks_get',
    'bakin_exec_tasks_create',
    'bakin_exec_tasks_move',
    'bakin_exec_tasks_block',
    'bakin_exec_tasks_complete',
    'bakin_exec_tasks_log_progress',
    'bakin_exec_tasks_set_dependency',
  ])('registers %s', (name) => {
    expect(findTool(activated.execTools, name)).toBeDefined()
  })
})

// ─── bakin_exec_tasks_list ─────────────────────────────────────────────────

describe('bakin_exec_tasks_list', () => {
  it('returns the full board when no filters are provided', async () => {
    const board = { columns: { todo: [{ id: 't1' }], done: [{ id: 't2' }] } }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(result.columns).toEqual(board.columns)
  })

  it('filters by column', async () => {
    const board = {
      columns: {
        todo: [{ id: 't1', agent: 'pixel' }],
        done: [{ id: 't2', agent: 'rolo' }],
      },
    }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, { column: 'todo' })

    expect(result.ok).toBe(true)
    expect((result.columns as Record<string, unknown[]>).todo).toHaveLength(1)
    expect((result.columns as Record<string, unknown[]>).done).toBeUndefined()
  })

  it('filters by agent', async () => {
    const board = {
      columns: {
        todo: [{ id: 't1', agent: 'pixel' }, { id: 't2', agent: 'rolo' }],
      },
    }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, { agent: 'pixel' })

    expect(result.ok).toBe(true)
    const cols = result.columns as Record<string, Array<{ agent: string }>>
    expect(cols.todo).toHaveLength(1)
    expect(cols.todo[0].agent).toBe('pixel')
  })

  it('returns error when taskboard is null', async () => {
    mockReadTaskboard.mockResolvedValue(null)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Failed to read')
  })
})

// ─── bakin_exec_tasks_get ──────────────────────────────────────────────────

describe('bakin_exec_tasks_get', () => {
  it('returns task details', async () => {
    const details = { task: { id: 'abc', title: 'Test' }, column: 'inProgress' }
    mockGetTaskDetails.mockResolvedValue(details)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    expect(result.ok).toBe(true)
    expect(result.task).toEqual(details.task)
  })

  it('returns error when task not found', async () => {
    mockGetTaskDetails.mockResolvedValue(null)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'missing' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('enriches with project context when projectId is present', async () => {
    const details = { task: { id: 'abc', projectId: 'proj-1' }, column: 'todo' }
    mockGetTaskDetails.mockResolvedValue(details)
    const mockHooksInvoke = activated.ctx.hooks.invoke as ReturnType<typeof vi.fn>
    mockHooksInvoke.mockResolvedValueOnce({
      title: 'Project X',
      status: 'active',
      progress: 50,
      body: 'This is the project body content for testing purposes.',
    })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    expect(result.ok).toBe(true)
    expect(result.projectTitle).toBe('Project X')
    expect(result.projectStatus).toBe('active')
    expect(result.projectProgress).toBe(50)
  })

  it('gracefully handles missing project plugin', async () => {
    const details = { task: { id: 'abc', projectId: 'proj-1' }, column: 'todo' }
    mockGetTaskDetails.mockResolvedValue(details)
    const mockHooksInvoke = activated.ctx.hooks.invoke as ReturnType<typeof vi.fn>
    mockHooksInvoke.mockRejectedValueOnce(new Error('Hook not found'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    // Should still succeed, just without project data
    expect(result.ok).toBe(true)
    expect(result.projectTitle).toBeUndefined()
  })
})

// ─── bakin_exec_tasks_create ───────────────────────────────────────────────

describe('bakin_exec_tasks_create', () => {
  it('creates a task with workflow', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t', workflowId: 'wf-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'New Task',
      assignee: 'pixel',
      workflowId: 'wf-1',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.id).toBe('new-t')
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Task',
        assignee: 'pixel',
        workflowId: 'wf-1',
        createdBy: 'chef',
        channel: 'mcp',
      })
    )
  })

  it('creates a task with skipWorkflowReason', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t2' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Simple Task',
      skipWorkflowReason: 'One-off cleanup',
    }, 'chef')

    expect(result.ok).toBe(true)
  })

  it('creates a subtask without workflow requirement', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'sub-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Subtask',
      parentId: 'parent-1',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.id).toBe('sub-1')
  })

  it('rejects top-level task without workflowId or skipWorkflowReason', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'Bad Task' }, 'chef')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('workflowId or skipWorkflowReason')
  })

  it('triggers dispatch when assignee is provided', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'disp-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Dispatched Task',
      assignee: 'pixel',
      workflowId: 'wf-1',
    }, 'chef')

    expect(mockTriggerDispatch).toHaveBeenCalled()
  })

  it('triggers dispatch when parentId is provided', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'disp-2' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Child Task',
      parentId: 'parent-1',
    }, 'chef')

    expect(mockTriggerDispatch).toHaveBeenCalled()
  })

  it('does not trigger dispatch for unassigned top-level tasks', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'no-disp' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Unassigned',
      workflowId: 'wf-1',
    }, 'chef')

    expect(mockTriggerDispatch).not.toHaveBeenCalled()
  })

  it('returns error on creation failure', async () => {
    mockCreateTaskWithEffects.mockRejectedValue(new Error('boom'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Fail',
      workflowId: 'wf-1',
    }, 'chef')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })
})

// ─── bakin_exec_tasks_move ─────────────────────────────────────────────────

describe('bakin_exec_tasks_move', () => {
  it('moves a task to a new column', async () => {
    mockMoveTaskWithEffects.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'review' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-m', 'review', 'pixel', { channel: 'mcp' })
  })

  it('requires reason when moving to blocked', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'blocked' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('reason is required')
  })

  it('returns error on move failure', async () => {
    mockMoveTaskWithEffects.mockRejectedValue(new Error('invalid transition'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'done' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid transition')
  })
})

// ─── bakin_exec_tasks_block ────────────────────────────────────────────────

describe('bakin_exec_tasks_block', () => {
  it('blocks a task', async () => {
    mockBlockTaskWithEffects.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 'task-b', reason: 'need API key' }, 'trainer')

    expect(result.ok).toBe(true)
    expect(mockBlockTaskWithEffects).toHaveBeenCalledWith('task-b', 'need API key', 'trainer', 'mcp')
  })

  it('returns error on block failure', async () => {
    mockBlockTaskWithEffects.mockRejectedValue(new Error('block err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 'task-b', reason: 'fail' }, 'trainer')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('block err')
  })
})

// ─── bakin_exec_tasks_complete ─────────────────────────────────────────────

describe('bakin_exec_tasks_complete', () => {
  it('completes a task', async () => {
    mockReportComplete.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_complete')!
    const result = await callTool(tool, { taskId: 'task-c', summary: 'All done' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockReportComplete).toHaveBeenCalledWith('task-c', 'pixel', 'All done', 'mcp')
  })

  it('returns error on completion failure', async () => {
    mockReportComplete.mockRejectedValue(new Error('complete err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_complete')!
    const result = await callTool(tool, { taskId: 'task-c', summary: 'fail' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('complete err')
  })
})

// ─── bakin_exec_tasks_log_progress ─────────────────────────────────────────

describe('bakin_exec_tasks_log_progress', () => {
  it('logs a progress update', async () => {
    mockLogProgress.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_log_progress')!
    const result = await callTool(tool, { taskId: 'task-lp', message: 'Step 3 done' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockLogProgress).toHaveBeenCalledWith('task-lp', 'pixel', 'Step 3 done', 'mcp')
  })

  it('returns error on log failure', async () => {
    mockLogProgress.mockRejectedValue(new Error('log err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_log_progress')!
    const result = await callTool(tool, { taskId: 'task-lp', message: 'fail' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('log err')
  })
})

// ─── bakin_exec_tasks_set_dependency ───────────────────────────────────────

describe('bakin_exec_tasks_set_dependency', () => {
  it('sets a dependency', async () => {
    mockSetDependencyWithEffects.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_set_dependency')!
    const result = await callTool(tool, { taskId: 'task-sd', dependsOn: 'task-other' }, 'rolo')

    expect(result.ok).toBe(true)
    expect(result.message).toContain('Dependency registered')
    expect(mockSetDependencyWithEffects).toHaveBeenCalledWith('task-sd', 'task-other', 'mcp')
  })

  it('returns error on dependency failure', async () => {
    mockSetDependencyWithEffects.mockRejectedValue(new Error('dep err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_set_dependency')!
    const result = await callTool(tool, { taskId: 'task-sd', dependsOn: 'task-other' }, 'rolo')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('dep err')
  })
})

// ─── Search Dual-Write ──────────────────────────────────────────────────────

describe('Search dual-write', () => {
  it('removes task from search on delete', async () => {
    mockDeleteTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-rm' },
    })

    // search.remove is fire-and-forget, give it a tick
    await new Promise(r => setTimeout(r, 20))

    expect(activated.ctx.search.remove).toHaveBeenCalledWith('task-rm')
  })

  it('updates search index on task assign via transform', async () => {
    mockAssignTask.mockReturnValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-asgn' },
      body: { agent: 'pixel' },
    })

    // search.transform is fire-and-forget, give it a tick
    await new Promise(r => setTimeout(r, 20))

    expect(activated.ctx.search.transform).toHaveBeenCalledWith(
      'task-asgn',
      [{ op: '$set', field: 'agent', value: 'pixel' }],
    )
  })
})
