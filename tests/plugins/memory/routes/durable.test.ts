/**
 * Tests for plugins/memory/lib/routes/durable.ts — durable tier browser routes.
 *
 * Two routes:
 *   GET /durable?agent=<id>          → list canonical files present for agent
 *   GET /durable/:agent/:basename    → rendered content of one file
 *
 * Both go through the runtime memory adapter.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-durable-route-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

const {
  mockReadDurableFile,
} = (() => ({
  mockReadDurableFile: mock<(agent: string, basename: string) => string | null>(),
}))()

import {
  durableListRoute,
  durableDetailRoute,
} from '../../../../plugins/memory/lib/routes/durable'
import type { PluginContext } from '@bakin/core/plugin-types'

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
      memory: {
        listTiers: mock(async () => [{ id: 'durable-tier', label: 'Durable', metadata: { sourceKind: 'durable' } }]),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          const agent = opts?.agentId ?? ''
          const content = mockReadDurableFile(agent, id)
          return content === null || content === undefined
            ? null
            : { id, tierId: 'durable-tier', agentId: agent, path: `/fake/${agent}/${id}`, content }
        }),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  } as unknown as PluginContext
}

function makeListReq(agent?: string): Request {
  const url = new URL('http://localhost/durable')
  if (agent !== undefined) url.searchParams.set('agent', agent)
  return new Request(url, { method: 'GET' })
}

function makeDetailReq(agent: string, basename: string): Request {
  const url = new URL(`http://localhost/durable/${agent}/${basename}`)
  // Bakin's plugin router extracts :agent/:basename into search params.
  url.searchParams.set('agent', agent)
  url.searchParams.set('basename', basename)
  return new Request(url, { method: 'GET' })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockReadDurableFile.mockReset()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('durableListRoute — shape', () => {
  it('is a GET /durable route', () => {
    expect(durableListRoute.method).toBe('GET')
    expect(durableListRoute.path).toBe('/durable')
  })
})

describe('durableListRoute — handler', () => {
  it('requires ?agent= and returns 400 if missing', async () => {
    const res = await durableListRoute.handler(makeListReq(), makeCtx())
    expect(res.status).toBe(400)
  })

  it('returns only canonical files that exist for the agent', async () => {
    mockReadDurableFile.mockImplementation((_a, file) =>
      file === 'SOUL.md' || file === 'MEMORY.md' ? 'body' : null,
    )
    const res = await durableListRoute.handler(makeListReq('main'), makeCtx())
    const body = await res.json() as { files: { name: string }[] }
    expect(res.status).toBe(200)
    expect(body.files.map((f) => f.name).sort()).toEqual(['MEMORY.md', 'SOUL.md'])
  })

  it('returns empty list when no canonical files exist for the agent', async () => {
    mockReadDurableFile.mockReturnValue(null)
    const res = await durableListRoute.handler(makeListReq('orphan'), makeCtx())
    const body = await res.json() as { files: unknown[] }
    expect(res.status).toBe(200)
    expect(body.files).toEqual([])
  })
})

describe('durableDetailRoute — shape', () => {
  it('is a GET /durable/:agent/:basename route', () => {
    expect(durableDetailRoute.method).toBe('GET')
    expect(durableDetailRoute.path).toBe('/durable/:agent/:basename')
  })
})

describe('durableDetailRoute — handler', () => {
  it('returns 400 if agent or basename is missing', async () => {
    const url = new URL('http://localhost/durable//')
    const res = await durableDetailRoute.handler(new Request(url, { method: 'GET' }), makeCtx())
    expect(res.status).toBe(400)
  })

  it('returns 404 when file is absent (adapter returns null)', async () => {
    mockReadDurableFile.mockReturnValue(null)
    const res = await durableDetailRoute.handler(makeDetailReq('main', 'SOUL.md'), makeCtx())
    expect(res.status).toBe(404)
  })

  it('returns { agent, file, content } when file exists', async () => {
    mockReadDurableFile.mockReturnValue('# hello\nbody')
    const res = await durableDetailRoute.handler(makeDetailReq('main', 'SOUL.md'), makeCtx())
    const body = await res.json() as { agent: string; file: string; content: string }
    expect(res.status).toBe(200)
    expect(body.agent).toBe('main')
    expect(body.file).toBe('SOUL.md')
    expect(body.content).toBe('# hello\nbody')
  })

  it('rejects non-canonical basenames with 404 (adapter guards, we pass through)', async () => {
    mockReadDurableFile.mockReturnValue(null)
    const res = await durableDetailRoute.handler(makeDetailReq('main', 'RANDOM.md'), makeCtx())
    expect(res.status).toBe(404)
  })
})
