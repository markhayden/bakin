/**
 * Contract: every search content type a core plugin registers has a client
 * hit renderer that produces a real navigation target.
 *
 * The server-side content-type registry and the client-side hit-renderer
 * registry are decoupled — a plugin can register a searchable table and
 * ship no renderer (schedule did), key the renderer under the wrong name
 * (`agents` vs the `team` table), or read a field the schema doesn't have
 * (`agent` vs `agent_id` — href silently null). All three shipped. This
 * test activates every core plugin with a recording ctx, imports every
 * client entry, and asserts each registered table resolves to a renderer
 * whose href for a schema-shaped hit is a non-null app path.
 */
// Env vars FIRST — src/lib/content-files.ts (pulled in transitively by the
// plugin server entries) calls getContentDir() at module top, which runs
// before mock.module can intercept. See CLAUDE.md § Testing Rules.
process.env.BAKIN_HOME = `${process.env.TMPDIR ?? '/tmp'}/bakin-test-hit-renderer-contract-mock`
process.env.OPENCLAW_HOME = `${process.env.BAKIN_HOME}/openclaw`

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-hit-renderer-contract-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), 'bakin-test-hit-renderer-contract-mock')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings'), audit: j(base, 'audit.jsonl'), db: j(base, 'bakin.db') }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), 'bakin-test-hit-renderer-contract-mock')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings'), audit: j(base, 'audit.jsonl'), db: j(base, 'bakin.db') }),
  }
})
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/watcher', () => ({
  watchFiles: mock(),
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  shouldIgnoreContentWatcherPath: mock(() => false),
  start: mock(),
  stop: mock(async () => {}),
  createInboxHandler: mock(() => async () => {}),
}))
// task-store — the tasks plugin reads the board during activation; keep it
// away from any real ~/.bakin. Both specifiers (alias + relative), per the
// runs-reader trap noted in tests/plugins/tasks/routes.test.ts.
const taskStoreMock = () => ({
  getSharedBakinTaskStore: mock(() => ({})),
  localDateString: mock(() => '2026-07-03'),
  normalizeColumn: mock((c: string) => c),
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
  getTasksByColumn: mock(() => []),
  getTasksByAgent: mock(() => []),
  readAllColumns: mock(() => ({})),
  getTodoTasks: mock(() => []),
  getAgentTasks: mock(() => []),
  createTask: mock(),
  moveTask: mock(),
  assignTask: mock(),
  deleteTask: mock(),
  addTaskLog: mock(),
  blockTask: mock(),
  updateTask: mock(),
  setDependency: mock(),
  clearDependency: mock(),
  reorderTasks: mock(),
  moveTaskToInProgress: mock(),
  archiveOldTasks: mock().mockReturnValue(0),
  getArchivedCount: mock(() => 0),
  autoArchiveDoneTasks: mock().mockReturnValue(0),
})
mock.module('@/core/task-store', taskStoreMock)
mock.module('../../src/core/task-store', taskStoreMock)
// content-files calls getContentDir() at module top (team plugin imports it)
// — mock the module itself, same as tests/plugins/team/exec-tools.test.ts.
const contentFilesMock = () => ({
  readAllContent: mock(() => ({})),
  readContentFile: mock(() => null),
  writeContentFile: mock(),
  readHeartbeats: mock(() => ({})),
})
mock.module('@/lib/content-files', contentFilesMock)
mock.module('../../src/lib/content-files', contentFilesMock)
mock.module('../../packages/adapter-openclaw/src/home', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), 'bakin-test-hit-renderer-contract-mock', 'openclaw')
  return {
    getOpenClawHome: () => base,
    getOpenClawPath: (...parts: string[]) => j(base, ...parts),
  }
})

import { activatePlugin } from './test-helpers'
import type { BakinPlugin } from '@bakin/core/plugin-types'
import type { SearchResult } from '../../packages/sdk/src/types/services'

// Dynamic imports — static plugin imports hoist above the env/mock setup
// and trip the content-dir test guard (same trap as team/exec-tools.test.ts).
// Server side: every core plugin that registers search content types.
const PLUGINS: BakinPlugin[] = [
  (await import('../../plugins/tasks')).default,
  (await import('../../plugins/assets')).default,
  (await import('../../plugins/memory')).default,
  (await import('../../plugins/team')).default,
  (await import('../../plugins/schedule')).default,
  (await import('../../plugins/workflows')).default,
]

// Client side: importing each entry runs registerPlugin() as a side effect.
await import('../../plugins/tasks/client')
await import('../../plugins/assets/client')
await import('../../plugins/memory/client')
await import('../../plugins/team/client')
await import('../../plugins/schedule/client')
await import('../../plugins/workflows/client')

const { getSearchHitRenderersSnapshot } = await import('../../packages/sdk/src/register')

interface RegisteredType {
  pluginId: string
  table: string
  schema: Record<string, unknown>
}

const registered: RegisteredType[] = []

/** Schema-shaped synthetic hit: every declared field gets a plausible value. */
function syntheticHit(table: string, schema: Record<string, unknown>): SearchResult {
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(schema)) fields[key] = `test-${key}`
  return { id: 'test-id', table: `bakin_${table}`, score: 1, fields }
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  for (const plugin of PLUGINS) {
    const activated = await activatePlugin(plugin, join(testDir, plugin.id))
    const search = activated.ctx.search as unknown as {
      registerContentType: { mock: { calls: unknown[][] } }
      registerFileBackedContentType: { mock: { calls: unknown[][] } }
    }
    const calls = [
      ...search.registerContentType.mock.calls,
      ...search.registerFileBackedContentType.mock.calls,
    ]
    for (const call of calls) {
      const def = call[0] as { table: string; schema: Record<string, unknown> }
      registered.push({ pluginId: plugin.id, table: def.table, schema: def.schema })
    }
  }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  rmSync(join(tmpdir(), 'bakin-test-hit-renderer-contract-mock'), { recursive: true, force: true })
})

describe('search hit-renderer contract', () => {
  it('every core plugin registered at least one content type', () => {
    expect(registered.length).toBeGreaterThanOrEqual(PLUGINS.length)
  })

  it('every registered content type has a renderer keyed by its bare table name', () => {
    const renderers = getSearchHitRenderersSnapshot()
    const missing = registered
      .filter(({ table }) => !renderers.get(table))
      .map(({ pluginId, table }) => `${pluginId}:${table}`)
    expect(missing).toEqual([])
  })

  it('every renderer produces a non-null app-path href for a schema-shaped hit', () => {
    const renderers = getSearchHitRenderersSnapshot()
    const broken: string[] = []
    for (const { pluginId, table, schema } of registered) {
      const renderer = renderers.get(table)
      if (!renderer) continue // covered by the previous assertion
      const descriptor = renderer(syntheticHit(table, schema))
      if (typeof descriptor.href !== 'string' || !descriptor.href.startsWith('/')) {
        broken.push(`${pluginId}:${table} → href=${String(descriptor.href)}`)
      }
      expect(descriptor.title).toBeTruthy()
    }
    expect(broken).toEqual([])
  })
})
