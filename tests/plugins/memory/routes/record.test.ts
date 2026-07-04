/**
 * Tests for plugins/memory/lib/routes/record.ts — GET /record?id=<rowId>.
 *
 * Resolves a unified memory rowId (`<tier>:<hash>`) to the exact row via
 * the side-effect-free tier enumerator — search-engine-independent, so a
 * ⌘K deep link works even when antfly is down. `skill:` rows are emitted
 * by the durable tier; `audit:` rows come from audit.jsonl.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-record-route-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
mock.module('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../../src/core/watcher', () => ({ watchFiles: mock() }))
mock.module('../../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

import { recordRoute } from '../../../../plugins/memory/lib/routes/record'
import { MemoryIndexer } from '../../../../plugins/memory/lib/indexer'
import type { PluginContext } from '@bakin/core/plugin-types'

const FIXTURE_ISO = '2026-07-01T12:00:00.000Z'
const AGENT = 'chef'

/** Minimal ctx: audit tier reads audit.jsonl via getBakinPaths; the
 *  runtime-backed tiers return nothing (list of agents is empty). */
function makeCtx(): PluginContext {
  return {
    pluginId: 'memory',
    storage: {} as PluginContext['storage'],
    events: {} as PluginContext['events'],
    registerNav: mock(),
    registerRoute: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    runtime: {
      agents: { list: mock(async () => []) },
      memory: {
        listTiers: mock(async () => []),
        listEntries: mock(async () => []),
        getEntry: mock(async () => null),
        statEntry: mock(async () => null),
        readEntryRange: mock(async () => null),
        resolvePath: mock(async () => null),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
    },
    hooks: { register: mock(() => () => {}), has: mock(() => false), invoke: mock(async () => undefined) },
  } as unknown as PluginContext
}

function makeReq(id?: string): Request {
  const qs = id === undefined ? '' : `?id=${encodeURIComponent(id)}`
  return new Request(`http://localhost/api/plugins/memory/record${qs}`)
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  // Two lines so the streaming reader's byte-offset tracking is exercised
  // on a non-zero offset (line 2) and compared against the enumerator.
  writeFileSync(
    join(testDir, 'audit.jsonl'),
    JSON.stringify({ ts: FIXTURE_ISO, event: 'task.created', agent: AGENT, data: { id: '1' } }) + '\n'
    + JSON.stringify({ ts: FIXTURE_ISO, event: 'task.completed', agent: AGENT, data: { id: '2' } }) + '\n',
  )
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /record', () => {
  it('resolves existing audit rowIds to their exact rows (both lines, offsets intact)', async () => {
    const ctx = makeCtx()
    // Discover the real keys/docs the enumerator emits for the fixture rows —
    // the streaming reader must produce identical docs, including the
    // byte-offset-bearing source metadata for the second line.
    const rows: Array<{ key: string; doc: Record<string, unknown> }> = []
    for await (const r of new MemoryIndexer(ctx, {}).enumerateTier('audit')) rows.push(r)
    expect(rows.length).toBe(2)

    for (const expected of rows) {
      expect(expected.key.startsWith('audit:')).toBe(true)
      const res = await recordRoute.handler(makeReq(expected.key), ctx, {})
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { id: string; table: string; fields: Record<string, unknown> } }
      expect(body.result.id).toBe(expected.key)
      expect(body.result.table).toBe('memory')
      expect(body.result.fields).toEqual(expected.doc)
    }
  })

  it('404s for a well-formed id that matches nothing', async () => {
    const res = await recordRoute.handler(makeReq('audit:deadbeefdeadbeef'), makeCtx(), {})
    expect(res.status).toBe(404)
  })

  it('routes skill: ids to the durable tier (404 here, not 400)', async () => {
    const res = await recordRoute.handler(makeReq('skill:deadbeefdeadbeef'), makeCtx(), {})
    expect(res.status).toBe(404)
  })

  it('400s on a malformed or unknown-prefix id', async () => {
    expect((await recordRoute.handler(makeReq(''), makeCtx(), {})).status).toBe(400)
    expect((await recordRoute.handler(makeReq('no-tier-prefix'), makeCtx(), {})).status).toBe(400)
    expect((await recordRoute.handler(makeReq('bogus:abcd'), makeCtx(), {})).status).toBe(400)
    expect((await recordRoute.handler(makeReq(), makeCtx(), {})).status).toBe(400)
  })
})
