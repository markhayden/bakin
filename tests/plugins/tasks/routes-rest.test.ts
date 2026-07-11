/**
 * Tests for tasks plugin REST routes (plugins/tasks/lib/routes.ts).
 * Split from routes.test.ts (FW7); shared mock scaffold lives in
 * helpers/tasks-routes-harness.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  activatePlugin,
  findRoute,
  callRoute,
  type ActivatedPlugin,
} from '../test-helpers'
import type { TaskRunEntry } from '@bakin/tasks/types'
import {
  ledgerMock,
  taskStoreMock,
  taskServiceMock,
  MockWorkflowTaskMoveError,
  resetTasksRoutesHarness,
  completionsFake,
  mockTaskRuns,
  mockReadTaskboard,
  mockDeleteTask,
  mockAssignTask,
  mockUpdateTask,
  mockReorderTasks,
  mockGetTaskWithColumn,
  mockMoveTaskWithEffects,
  mockBlockTaskWithEffects,
  mockCreateTaskWithEffects,
  mockSetDependencyWithEffects,
  mockGetTaskDetails,
  mockLogProgress,
} from './helpers/tasks-routes-harness'

// ─── Mocks ─────────────────────────────────────────────────────────────────
// (mock.module stays per-file — FW1.8 dual mocks on every split surface;
// the shared mock functions and module factories live in the harness helper)

const testDir = join(process.cwd(), 'test-content-tasks-routes-rest')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    tasks: join(testDir, 'tasks'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    tasks: join(testDir, 'tasks'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/lib/content-files', () => ({
  readContentFile: mock(() => null),
  writeContentFile: mock(),
}))

mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../../src/core/execution-ledger', ledgerMock)

mock.module('../../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: mock(),
}))

// Both specifiers — runs-reader imports task-store relatively (same trap as the ledger mock).
mock.module('@/core/task-store', taskStoreMock)
mock.module('../../../src/core/task-store', taskStoreMock)

mock.module('../../../src/core/task-service', taskServiceMock)

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
  mock.clearAllMocks()
  resetTasksRoutesHarness()
})

// ─── Routing — :taskId requirement (replaces 6 legacy skipped cases) ───────
//
// Pre-T6, plugin handlers manually checked `url.searchParams.get('taskId')`
// and returned 400 when absent. Post-T6 the dispatcher's path-param
// validation owns this — the path itself encodes the taskId. The tests
// below assert routing-level behavior: the route exists at the right path
// shape, and matchRoute (used by the catch-all) requires the segment.

describe('Tasks Plugin — :taskId path-param routing', () => {
  it('GET / and /:taskId are distinct routes', () => {
    const list = findRoute(activated.routes, 'GET', '/')
    const get = findRoute(activated.routes, 'GET', '/:taskId')
    expect(list).toBeDefined()
    expect(get).toBeDefined()
    expect(list).not.toBe(get)
  })

  it('PUT /:taskId, DELETE /:taskId, and POST /:taskId/{assign,log,move,block,complete,dependency} all require the path segment', () => {
    const requireParam = [
      ['PUT', '/:taskId'],
      ['DELETE', '/:taskId'],
      ['POST', '/:taskId/assign'],
      ['POST', '/:taskId/log'],
      ['POST', '/:taskId/move'],
      ['POST', '/:taskId/block'],
      ['POST', '/:taskId/complete'],
      ['POST', '/:taskId/dependency'],
    ] as const
    for (const [method, path] of requireParam) {
      const route = findRoute(activated.routes, method, path)
      expect(route).toBeDefined()
      // Routing assertion: the route declares :taskId as a path segment.
      // Without it in the URL, the catch-all would not match this route at all.
      expect(route?.path).toContain(':taskId')
    }
  })
})

// ─── Route Registration ────────────────────────────────────────────────────

describe('Tasks Plugin — Route Registration', () => {
  it('registers 15 routes', () => {
    expect(activated.routes.length).toBe(15)
  })

  it.each([
    ['GET', '/'],
    ['GET', '/summary'],
    ['GET', '/:taskId'],
    ['GET', '/:taskId/runs'],
    ['POST', '/'],
    ['PUT', '/:taskId'],
    ['DELETE', '/:taskId'],
    ['POST', '/:taskId/move'],
    ['POST', '/:taskId/assign'],
    ['POST', '/:taskId/log'],
    ['POST', '/:taskId/block'],
    ['POST', '/:taskId/dependency'],
    ['POST', '/reorder'],
    ['GET', '/search'],
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

// ─── GET /summary — Nav badge counts ───────────────────────────────────────

describe('GET /summary — nav badge counts', () => {
  it('returns blocked and review counts only', async () => {
    mockReadTaskboard.mockResolvedValue({
      columns: {
        blocked: [{ id: 'b1' }, { id: 'b2' }],
        review: [{ id: 'r1' }],
        todo: [{ id: 't1' }],
      },
    })

    const route = findRoute(activated.routes, 'GET', '/summary')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(200)
    expect(body).toEqual({ blocked: 2, review: 1 })
  })

  it('reports zeros on an empty board', async () => {
    mockReadTaskboard.mockResolvedValue({ columns: { blocked: [], review: [] } })

    const route = findRoute(activated.routes, 'GET', '/summary')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(200)
    expect(body).toEqual({ blocked: 0, review: 0 })
  })

  it('returns 500 on error', async () => {
    mockReadTaskboard.mockRejectedValue(new Error('summary read failed'))

    const route = findRoute(activated.routes, 'GET', '/summary')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(500)
    expect(body.error).toContain('summary read failed')
  })

  // The literal `/summary` is registered as its own route, distinct from the
  // `/:taskId` param route. Precedence at dispatch time (literal beats param)
  // is guaranteed + tested by the core routing registry; here we just pin that
  // the route is registered under its own path.
  it('registers /summary as a distinct literal route', () => {
    const summary = findRoute(activated.routes, 'GET', '/summary')
    expect(summary?.path).toBe('/summary')
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

// ─── GET /:taskId/runs — run history ───────────────────────────────────────

describe('GET /:taskId/runs — dispatch run history', () => {
  it('maps ledger runs to entries newest-first with status, settle reason, and duration', async () => {
    const t0 = 1_700_000_000_000
    const row = (over: Record<string, unknown>) => ({
      taskId: 'task-runs', execKey: 'task-runs', agent: 'pixel', bootId: 'b',
      heartbeatAt: t0, settledAt: null, settleReason: null, ...over,
    })
    // Seeded newest-first (as the real listRunsByTask returns them).
    mockTaskRuns['task-runs'] = [
      row({ runId: 'task:task-runs:d3', seq: 3, status: 'running', startedAt: t0 + 2000 }),
      row({ runId: 'task:task-runs:d2', seq: 2, status: 'settled', startedAt: t0 + 1000, settledAt: t0 + 1500, settleReason: 'turn-ok' }),
      row({ runId: 'task:task-runs:d1', seq: 1, status: 'lost', startedAt: t0, settledAt: t0 + 200, settleReason: 'session-death' }),
    ]

    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'task-runs' } })

    expect(status).toBe(200)
    const runs = body.runs as TaskRunEntry[]
    expect(runs.map(r => r.seq)).toEqual([3, 2, 1])
    expect(runs.map(r => r.status)).toEqual(['running', 'settled', 'lost'])
    expect(runs.find(r => r.seq === 2)).toMatchObject({ settleReason: 'turn-ok', durationMs: 500, agent: 'pixel' })
    expect(runs.find(r => r.seq === 3)?.durationMs).toBeUndefined() // still running, no duration
    expect(runs[0].startedAt).toBe(new Date(t0 + 2000).toISOString())
  })

  it('returns an empty list for a task with no runs (never an error)', async () => {
    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'no-runs' } })
    expect(status).toBe(200)
    expect(body.runs).toEqual([])
  })

  it('includes a done outcome from the completion ledger alongside the runs', async () => {
    const completedAt = 1_700_000_500_000
    completionsFake.set('task-done', { taskId: 'task-done', runId: 'task:task-done:d1', agent: 'pixel', channel: null, completedAt })
    mockTaskRuns['task-done'] = [{
      runId: 'task:task-done:d1', taskId: 'task-done', seq: 1, agent: 'pixel', status: 'settled',
      startedAt: completedAt - 1000, settledAt: completedAt, settleReason: 'turn-ok',
    }]

    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'task-done' } })

    expect(status).toBe(200)
    expect(body.outcome).toEqual({
      state: 'done',
      completedAt: new Date(completedAt).toISOString(),
      agent: 'pixel',
    })
  })

  it('derives the outcome from the task column when no completion exists', async () => {
    mockGetTaskWithColumn.mockReturnValue({ task: { id: 'task-blocked' }, column: 'blocked' })
    mockTaskRuns['task-blocked'] = [{
      runId: 'task:task-blocked:d1', taskId: 'task-blocked', seq: 1, agent: 'pixel', status: 'settled',
      startedAt: 1_700_000_000_000, settledAt: 1_700_000_001_000, settleReason: 'turn-ok',
    }]

    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    const { body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'task-blocked' } })

    expect(body.outcome).toEqual({ state: 'blocked' })
  })

  it('omits the outcome key for an unknown task', async () => {
    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'ghost' } })
    expect(status).toBe(200)
    expect(body.runs).toEqual([])
    expect('outcome' in body).toBe(false)
  })

  it('never touches the task store for a task with no runs (unknown ids would trigger a full shard walk)', async () => {
    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    await callRoute(route, activated.ctx, { searchParams: { taskId: 'ghost' } })
    expect(mockGetTaskWithColumn).not.toHaveBeenCalled()
  })

  it('still reports done for a completed task with no runs (completion lookup is cheap and ungated)', async () => {
    const completedAt = 1_700_000_500_000
    completionsFake.set('done-no-runs', { taskId: 'done-no-runs', runId: null, agent: 'pixel', channel: null, completedAt })

    const route = findRoute(activated.routes, 'GET', '/:taskId/runs')!
    const { body } = await callRoute(route, activated.ctx, { searchParams: { taskId: 'done-no-runs' } })

    expect(body.outcome).toMatchObject({ state: 'done' })
    expect(mockGetTaskWithColumn).not.toHaveBeenCalled()
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
    expect(body.error).toBe('invalid input')
  })

  it('creates a team-assigned task (#189)', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'team-1' })

    const route = findRoute(activated.routes, 'POST', '/')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { title: 'Team task', team: 'development' },
    })

    expect(status).toBe(200)
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({ team: 'development' })
    )
  })

  it('rejects assignee + team together with 400 (#189)', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { title: 'Bad', assignee: 'pixel', team: 'development' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('both')
    expect(mockCreateTaskWithEffects).not.toHaveBeenCalled()
  })

  it('rejects an unknown team with 400 (#189)', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { title: 'Bad', team: 'ghost-team' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('Unknown team')
    expect(mockCreateTaskWithEffects).not.toHaveBeenCalled()
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

  it('passes scheduling and provenance fields through on create', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'scheduled-1' })

    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: {
        title: 'Scheduled kickoff',
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: '2026-05-22T15:00:00.000Z',
        source: {
          pluginId: 'messaging',
          entityType: 'deliverable',
          entityId: 'deliverable-1',
          purpose: 'kickoff',
        },
      },
    })

    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: '2026-05-22T15:00:00.000Z',
        source: {
          pluginId: 'messaging',
          entityType: 'deliverable',
          entityId: 'deliverable-1',
          purpose: 'kickoff',
        },
      }),
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

  it('passes scheduling fields through on update', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: {
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: null,
        source: null,
      },
    })

    expect(status).toBe(200)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      availableAt: '2026-05-18T15:00:00.000Z',
      dueAt: null,
      source: null,
    }))
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

  it('title-only update does NOT clear stored team/agent (partial update, review R1)', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { title: 'Just a rename' },
    })

    expect(status).toBe(200)
    const updates = mockUpdateTask.mock.calls[0][1] as Record<string, unknown>
    // Absent body fields must be absent KEYS — updateTask clears on key
    // presence ('team' in updates), so a passthrough undefined wipes data.
    expect('team' in updates).toBe(false)
    expect('agent' in updates).toBe(false)
    expect('description' in updates).toBe(false)
    expect(updates.title).toBe('Just a rename')
  })

  it('explicit empty-string team/agent still clear (partial update, review R1)', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { agent: '', team: '' },
    })

    const updates = mockUpdateTask.mock.calls[0][1] as Record<string, unknown>
    expect('team' in updates).toBe(true)
    expect('agent' in updates).toBe(true)
  })

  it('re-assigns to a team through update (#189)', async () => {
    mockUpdateTask.mockResolvedValue(undefined)

    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { team: 'development' },
    })

    expect(status).toBe(200)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ team: 'development' }))
  })

  it('rejects agent + team together on update with 400 (#189)', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { agent: 'pixel', team: 'development' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('both')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('rejects an unknown team on update with 400 (#189)', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-1' },
      body: { team: 'ghost-team' },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('Unknown team')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })
})

// ─── DELETE /:taskId — Delete Task ─────────────────────────────────────────

describe('DELETE /:taskId — Delete Task', () => {
  it('deletes a task by taskId', async () => {
    mockDeleteTask.mockResolvedValue('task-del')

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-del' },
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDeleteTask).toHaveBeenCalledWith('task-del')
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith('deleted', 'system', { taskId: 'task-del' })
  })

  it('audits and removes the search doc by the RESOLVED id when deleting by title (review F4)', async () => {
    mockDeleteTask.mockResolvedValue('resolved-id-99')
    const searchRemove = activated.ctx.search.remove as ReturnType<typeof mock>
    searchRemove.mockClear()

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'Fix login bug' }, // title fallback, not an id
    })

    expect(status).toBe(200)
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith('deleted', 'system', { taskId: 'resolved-id-99' })
    expect(searchRemove).toHaveBeenCalledWith('resolved-id-99')
  })


  it('does NOT invoke workflow-instance cleanup itself — deleteTask owns the full cascade (#604 T5)', async () => {
    mockDeleteTask.mockResolvedValue('task-with-wf')
    const hooks = activated.ctx.hooks as unknown as {
      has: ReturnType<typeof mock>
      invoke: ReturnType<typeof mock>
    }
    hooks.has.mockReturnValue(true)
    hooks.invoke.mockClear()

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-with-wf' },
    })

    expect(status).toBe(200)
    expect(mockDeleteTask).toHaveBeenCalledWith('task-with-wf')
    expect(hooks.invoke).not.toHaveBeenCalledWith('workflows.deleteInstance', expect.anything())
    hooks.has.mockReturnValue(false)
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
    mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    expect(body.error).toBe('invalid input')
  })

  it('returns 400 when agent is missing', async () => {
    const route = findRoute(activated.routes, 'POST', '/:taskId/move')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-mv' },
      body: { to: 'review' },
    })

    expect(status).toBe(400)
    expect(body.error).toBe('invalid input')
  })

  it('returns 403 for workflow-blocked moves', async () => {
    mockMoveTaskWithEffects.mockRejectedValue(new MockWorkflowTaskMoveError())

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
    mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    mockBlockTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    expect(body.error).toBe('invalid input')
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
    mockBlockTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    mockBlockTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

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
    expect(body.error).toBe('invalid input')
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
    expect(body.error).toBe('invalid input')
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
    expect(body.error).toBe('invalid input')
  })

  it('returns 400 when orderedIds is not an array', async () => {
    const route = findRoute(activated.routes, 'POST', '/reorder')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { columnId: 'todo', orderedIds: 'not-array' },
    })

    expect(status).toBe(400)
    expect(body.error).toBe('invalid input')
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
