/**
 * Tests for the tasks plugin search surface (plugins/tasks/lib/search-doc.ts
 * wiring): index side effects on delete/assign and the GET /search route.
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
  callSearchRoute,
  type ActivatedPlugin,
} from '../test-helpers'
import {
  ledgerMock,
  taskStoreMock,
  taskServiceMock,
  resetTasksRoutesHarness,
  mockDeleteTask,
  mockAssignTask,
} from './helpers/tasks-routes-harness'
import { waitUntil } from '../../helpers/wait'

// ─── Mocks ─────────────────────────────────────────────────────────────────
// (mock.module stays per-file — FW1.8 dual mocks on every split surface;
// the shared mock functions and module factories live in the harness helper)

const testDir = join(process.cwd(), 'test-content-tasks-search-doc')

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

// ─── Doc mapping ─────────────────────────────────────────────────────────────

describe('taskToSearchDoc', () => {
  it('maps brandId → brand_id keyword (#419)', async () => {
    const { taskToSearchDoc } = await import('../../../plugins/tasks/lib/search-doc')
    const doc = taskToSearchDoc(
      { id: 't1', title: 'Branded', brandId: 'acme' } as never,
      'todo' as never,
    )
    expect(doc.brand_id).toBe('acme')
    const bare = taskToSearchDoc({ id: 't2', title: 'Plain' } as never, 'todo' as never)
    expect(bare.brand_id).toBe('')
  })
})

// ─── Search Index Side Effects ──────────────────────────────────────────────

describe('Search index side effects', () => {
  it('removes task from search on delete', async () => {
    mockDeleteTask.mockResolvedValue('task-rm')

    const route = findRoute(activated.routes, 'DELETE', '/:taskId')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-rm' },
    })

    // search.remove is fire-and-forget — poll for it rather than guessing a tick
    await waitUntil(() => (activated.ctx.search.remove as ReturnType<typeof mock>).mock.calls.length > 0,
      { label: 'the fire-and-forget search.remove to land' })

    expect(activated.ctx.search.remove).toHaveBeenCalledWith('task-rm')
  })

  it('updates search index on task assign via transform', async () => {
    mockAssignTask.mockReturnValue(undefined)

    const route = findRoute(activated.routes, 'POST', '/:taskId/assign')!
    await callRoute(route, activated.ctx, {
      searchParams: { taskId: 'task-asgn' },
      body: { agent: 'pixel' },
    })

    // search.transform is fire-and-forget — poll for it rather than guessing a tick
    await waitUntil(() => (activated.ctx.search.transform as ReturnType<typeof mock>).mock.calls.length > 0,
      { label: 'the fire-and-forget search.transform to land' })

    expect(activated.ctx.search.transform).toHaveBeenCalledWith(
      'task-asgn',
      [{ op: '$set', field: 'agent', value: 'pixel' }],
    )
  })
})

// ─── Search Route ───────────────────────────────────────────────────────────

describe('Tasks Plugin — GET /search', () => {
  beforeEach(() => {
    activated.seedResults([])
  })

  it('returns seeded results for a valid query', async () => {
    activated.seedResults([
      { id: 't1', table: 'bakin_tasks', score: 0.9, fields: { title: 'Test task' } },
    ])

    const { status, body } = await callSearchRoute(activated, 'test')

    expect(status).toBe(200)
    const results = body.results as Array<{ id: string; score: number }>
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('t1')
    expect(results[0].score).toBe(0.9)
  })

  it('returns 400 when q is missing', async () => {
    const { status, body } = await callSearchRoute(activated, '')

    expect(status).toBe(400)
    expect(body.error).toBe('invalid input')
  })

  it('returns 200 with empty results when no matches', async () => {
    const { status, body } = await callSearchRoute(activated, 'zzz')

    expect(status).toBe(200)
    expect(body.results).toEqual([])
  })

  it('passes parsed facets to ctx.search.query', async () => {
    await callSearchRoute(activated, 'test', { facets: 'status,agent' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'test',
        facets: ['status', 'agent'],
      }),
    )
  })
})
