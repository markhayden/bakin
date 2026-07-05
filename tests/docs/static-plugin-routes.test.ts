/**
 * Regression test for the route-contracts spec acceptance criteria.
 *
 * Each in-repo plugin must export `default.routes` populated with at least
 * one defineRoute() entry at module load time (i.e., without invoking
 * `activate()`). Confirms team and workflows aren't outside the
 * route-contract gate via the mutable-array pattern.
 *
 * Also verifies every exported route passes the bundled validator's
 * strict checks: visibility, summary/description, params for :placeholder
 * paths, body schema for JSON bodies, at least one 2xx response with a
 * schema for JSON 2xx.
 */
import { describe, it, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-static-routes-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
mkdirSync(join(testDir, 'openclaw'), { recursive: true })
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

const stubBakinPaths = () => ({
  home: testDir,
  memoryLog: join(testDir, 'MEMORY-LOG.md'),
  audit: join(testDir, 'audit.jsonl'),
  assets: join(testDir, 'assets'),
  'assets.store': join(testDir, 'assets', 'store'),
  'assets.inbox': join(testDir, 'assets', 'inbox'),
  'assets.trash': join(testDir, 'assets', '.trash'),
  agents: join(testDir, 'agents'),
  personas: join(testDir, 'team', 'personas'),
  team: join(testDir, 'team'),
  heartbeats: join(testDir, 'heartbeats'),
  inbox: join(testDir, 'inbox'),
  tasks: join(testDir, 'tasks'),
  workflows: join(testDir, 'workflows'),
  settings: join(testDir, 'settings.json'),
  logs: join(testDir, 'logs'),
})

const contentDirMock = {
  getContentDir: () => testDir,
  getBakinPaths: stubBakinPaths,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => ({ created: [], seeded: [] }),
}

mock.module('../../src/core/content-dir', () => contentDirMock)
mock.module('../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// Task-store stubs — plugins import these at module-load time. Bun's
// mock.module overlays leak across files even with --isolate (see
// route-contract-check.test.ts and zod-to-openapi.test.ts which install
// `() => ({})` stubs). Provide every symbol the in-repo plugins import so
// the import statement can resolve regardless of which file ran first.
const emptyBoard = { columns: { backlog: [], todo: [], inProgress: [], blocked: [], review: [], done: [], archived: [] } }
mock.module('../../src/core/task-store', () => ({
  readTaskboard: () => emptyBoard,
  getAllTasks: () => emptyBoard,
  getTask: () => null,
  getTaskWithColumn: () => null,
  getTasksByColumn: () => [],
  getTasksByAgent: () => [],
  readAllColumns: () => emptyBoard.columns,
  getTodoTasks: () => ({ columns: emptyBoard.columns, todoTasks: [] }),
  getAgentTasks: () => [],
  createTask: async () => ({ id: 'stub' }),
  moveTask: async () => {},
  assignTask: async () => {},
  deleteTask: async () => {},
  addTaskLog: async () => {},
  blockTask: async () => {},
  updateTask: async () => {},
  setDependency: async () => {},
  clearDependency: async () => {},
  reorderTasks: async () => {},
  moveTaskToInProgress: async () => {},
  assignTaskToTeam: async () => {},
  recordTeamResolution: async () => {},
  archiveOldTasks: () => 0,
  autoArchiveDoneTasks: () => 0,
  getSharedBakinTaskStore: () => ({ subscribe: () => () => {} }),
  localDateString: () => new Date().toISOString().slice(0, 10),
  normalizeColumn: (c: string) => c,
  VALID_TRANSITIONS: {},
}))

import { validateRouteContracts } from '../../scripts/docs/route-contract-check-lib'

const IN_REPO_PLUGINS = ['assets', 'git', 'health', 'memory', 'models', 'schedule', 'tasks', 'team', 'workflows'] as const

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('static plugin route exports', () => {
  for (const id of IN_REPO_PLUGINS) {
    it(`plugins/${id} exports default.routes populated at module load (no activate())`, async () => {
      const mod = await import(join(process.cwd(), 'plugins', id, 'index.ts')) as { default?: { routes?: ReadonlyArray<unknown> } }
      const routes = mod.default?.routes ?? []
      expect(Array.isArray(routes)).toBe(true)
      expect(routes.length).toBeGreaterThan(0)
    })
  }

  it('every in-repo plugin passes the strict route-contract validator', async () => {
    const pluginRoutes: Record<string, ReadonlyArray<any>> = {}
    for (const id of IN_REPO_PLUGINS) {
      const mod = await import(join(process.cwd(), 'plugins', id, 'index.ts')) as { default?: { routes?: ReadonlyArray<any> } }
      pluginRoutes[id] = mod.default?.routes ?? []
    }
    const result = validateRouteContracts({
      pluginRoutes,
      coreRoutes: [],
      mode: 'error',
    })
    if (result.errors.length > 0) {
      console.error('Validator errors:')
      for (const f of result.errors) console.error(`  ${f.scope} ${f.method} ${f.path} — ${f.issue}`)
    }
    expect(result.errors).toEqual([])
  })

  it('coreRoutes export is populated and passes strict validator', async () => {
    const { coreRoutes } = await import('../../packages/host/src/core-routes')
    expect(coreRoutes.length).toBeGreaterThan(0)
    const result = validateRouteContracts({
      pluginRoutes: {},
      coreRoutes,
      mode: 'error',
    })
    expect(result.errors).toEqual([])
  })
})
