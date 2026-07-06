/**
 * Edit safety (SPEC §8 test #6): optimistic versioning + freeze-on-complete.
 * No leases — a stale writer gets a 409 + audit, never silent loss; a
 * completed task refuses mutation until explicitly reopened.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { activatePlugin, findRoute, findTool, callRoute, callTool, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-edit-safety-${Date.now()}-${randomUUID()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

const contentDirMock = () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
  getBakinPaths: () => ({
    home: testDir,
    tasks: join(testDir, 'tasks'),
    heartbeats: join(testDir, 'heartbeats'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../../src/lib/content-files', () => ({
  readContentFile: mock(() => null),
  writeContentFile: mock(),
}))

mock.module('../../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: mock(),
}))

// Stateful task fake with version counters (mirrors the store's writeUpdated bump).
type FakeTask = { id: string; title: string; agent?: string; version?: number }
const tasks = new Map<string, FakeTask>()
const bump = (id: string) => {
  const task = tasks.get(id)
  if (task) task.version = (task.version ?? 0) + 1
}
const mockUpdateTask = mock(async (id: string) => bump(id))
const mockAssignTask = mock(async (id: string) => bump(id))

mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock((id: string) => tasks.get(id) ?? null),
  getTaskWithColumn: mock(() => null),
  updateTask: mockUpdateTask,
  assignTask: mockAssignTask,
  deleteTask: mock(async () => {}),
  addTaskLog: mock(async () => {}),
  blockTask: mock(async () => {}),
  createTask: mock(async () => ({ id: 'new' })),
  moveTask: mock(async () => {}),
  setDependency: mock(async () => {}),
  clearDependency: mock(async () => {}),
  reorderTasks: mock(async () => {}),
  autoArchiveDoneTasks: mock(() => 0),
  archiveOldTasks: mock(() => 0),
}))

const mockSetDependencyWithEffects = mock(async () => {})
const mockBlockTaskWithEffects = mock(async (): Promise<{ alreadyComplete: boolean }> => ({ alreadyComplete: false }))
mock.module('../../../src/core/task-service', () => ({
  validateTeamRef: async () => undefined,
  validateTeamAssignment: async () => undefined,
  TaskValidationError: class extends Error {},
  moveTaskWithEffects: mock(async () => ({ alreadyComplete: false })),
  blockTaskWithEffects: mockBlockTaskWithEffects,
  createTaskWithEffects: mock(async () => ({ id: 'new' })),
  reportComplete: mock(async () => ({ alreadyComplete: false })),
  setDependencyWithEffects: mockSetDependencyWithEffects,
  getTaskDetails: mock(async () => null),
  logProgress: mock(async () => {}),
  triggerDispatch: mock(),
}))

import { recordCompletion, deleteCompletion } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'
import { resolveTaskIdentifier } from '../../../plugins/tasks/lib/edit-guard'

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  const plugin = (await import('../../../plugins/tasks')).default
  activated = await activatePlugin(plugin, testDir)
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  tasks.clear()
  tasks.set('t-1', { id: 't-1', title: 'Editable', agent: 'pixel', version: 3 })
  deleteCompletion('t-1')
  mockUpdateTask.mockClear()
  mockAssignTask.mockClear()
  mockSetDependencyWithEffects.mockClear()
  ;(activated.ctx.activity.audit as ReturnType<typeof mock>).mockClear()
})

describe('resolveTaskIdentifier', () => {
  it('prefers path param, then body.id, then the title fallbacks', () => {
    expect(resolveTaskIdentifier('t-1', { id: 't-2', title: 'T' })).toBe('t-1')
    expect(resolveTaskIdentifier(undefined, { id: 't-2', title: 'T' })).toBe('t-2')
    expect(resolveTaskIdentifier(undefined, { title: 'T' })).toBe('T')
    expect(resolveTaskIdentifier(undefined, {})).toBeUndefined()
  })

  it('update mode: body.title is payload, body.originalTitle is the identifier', () => {
    expect(resolveTaskIdentifier(undefined, { originalTitle: 'Old', title: 'New' }, { bodyTitleIsPayload: true })).toBe('Old')
    expect(resolveTaskIdentifier(undefined, { title: 'New' }, { bodyTitleIsPayload: true })).toBeUndefined()
  })
})

describe('optimistic versioning', () => {
  it('rejects a stale expectedVersion with 409 + edit_conflict audit; nothing is written', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      path: '/t-1',
      body: { title: 'New title', expectedVersion: 2 },
    })

    expect(status).toBe(409)
    expect(String(body.error)).toContain('Version conflict')
    expect(body.currentVersion).toBe(3)
    expect(mockUpdateTask).not.toHaveBeenCalled()
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith(
      'edit_conflict',
      expect.anything(),
      expect.objectContaining({ taskId: 't-1', expectedVersion: 2, currentVersion: 3 }),
    )
  })

  it('accepts a matching expectedVersion and writes', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      path: '/t-1',
      body: { title: 'New title', expectedVersion: 3 },
    })
    expect(status).toBe(200)
    expect(mockUpdateTask).toHaveBeenCalledTimes(1)
    expect(tasks.get('t-1')?.version).toBe(4)
  })

  it('omitting expectedVersion preserves last-write-wins for non-participating writers', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      path: '/t-1',
      body: { title: 'No version sent' },
    })
    expect(status).toBe(200)
    expect(mockUpdateTask).toHaveBeenCalledTimes(1)
  })

  it('the MCP update tool honors expectedVersion (REST parity)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_update')!

    const stale = await callTool(tool, { taskId: 't-1', title: 'Nope', expectedVersion: 2 }, 'pixel')
    expect(stale.ok).toBe(false)
    expect(String(stale.error)).toContain('Version conflict')
    expect(mockUpdateTask).not.toHaveBeenCalled()
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith(
      'edit_conflict',
      'pixel',
      expect.objectContaining({ taskId: 't-1', expectedVersion: 2, currentVersion: 3 }),
    )

    const fresh = await callTool(tool, { taskId: 't-1', title: 'Yep', expectedVersion: 3 }, 'pixel')
    expect(fresh.ok).toBe(true)
    expect(mockUpdateTask).toHaveBeenCalledTimes(1)
  })
})

describe('freeze-on-complete', () => {
  beforeEach(() => {
    recordCompletion('t-1', { agent: 'pixel', channel: 'mcp' })
  })

  it.each([
    ['PUT', '/:taskId', '/t-1', { title: 'Nope' }],
    ['POST', '/:taskId/assign', '/t-1/assign', { agent: 'chef' }],
    ['POST', '/:taskId/dependency', '/t-1/dependency', { dependsOn: 't-2' }],
    ['POST', '/:taskId/block', '/t-1/block', { reason: 'why', agent: 'pixel' }],
  ] as const)('%s %s refuses to mutate a completed task', async (method, routePath, callPath, body) => {
    const route = findRoute(activated.routes, method, routePath)!
    const { status, body: res } = await callRoute(route, activated.ctx, { path: callPath, body })
    expect(status).toBe(409)
    expect(String(res.error)).toContain('reopen')
  })

  it('the MCP update tool refuses too (agents get a clear error, not silence)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_update')!
    const result = await callTool(tool, { taskId: 't-1', description: 'Nope' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('reopen')
  })

  it('the MCP assign tool refuses (REST parity — no write reaches the store)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_assign')!
    const result = await callTool(tool, { taskId: 't-1', agent: 'chef' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('reopen')
    expect(mockAssignTask).not.toHaveBeenCalled()
  })

  it('the MCP set_dependency tool refuses (REST parity — no dependency is written)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_set_dependency')!
    const result = await callTool(tool, { taskId: 't-1', dependsOn: 't-2' }, 'pixel')
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('reopen')
    expect(mockSetDependencyWithEffects).not.toHaveBeenCalled()
  })

  it('reopen unfreezes: after deleteCompletion the edit succeeds', async () => {
    deleteCompletion('t-1')
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, { path: '/t-1', body: { title: 'Editable again' } })
    expect(status).toBe(200)
  })
})

describe('block-on-done entry points', () => {
  it('POST /:taskId/move with to=blocked maps alreadyComplete to a 409, like the guarded block route', async () => {
    mockBlockTaskWithEffects.mockResolvedValueOnce({ alreadyComplete: true })
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      path: '/t-1/move',
      body: { to: 'blocked', reason: 'kanban drag on a done card', agent: 'human', channel: 'human' },
    })
    expect(status).toBe(409)
    expect(String(body.error)).toContain('reopen')
  })

  it('MCP block tool returns the soft already-complete payload, never an error', async () => {
    mockBlockTaskWithEffects.mockResolvedValueOnce({ alreadyComplete: true })
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 't-1', reason: 'stale retry' }, 'pixel')
    expect(result.ok).toBe(true)
    expect(result.alreadyComplete).toBe(true)
    expect(String(result.note)).toContain('Reopen')
  })

  it('blocking an uncompleted task still works through both entry points', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      path: '/t-1/move',
      body: { to: 'blocked', reason: 'waiting on api', agent: 'pixel' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 't-1', reason: 'waiting on api' }, 'pixel')
    expect(result.ok).toBe(true)
    expect(result.alreadyComplete).toBeUndefined()
  })
})
