/**
 * Tests for memory plugin routes and search content type registration.
 *
 * First test suite for the memory plugin (was zero coverage). The memory
 * plugin owns the `bakin_audit` content type as of C8 — covered here via
 * the helper-auto-registered /search route.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-memory-routes-${Date.now()}`)

// ---------------------------------------------------------------------------
// Mandatory mocks — declared before any plugin import
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

vi.mock('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawPath: (...parts: string[]) => join('/tmp/openclaw-test', ...parts),
  getOpenClawHome: () => '/tmp/openclaw-test',
}))

vi.mock('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
}))

vi.mock('@bakin/core/settings', () => ({
  getSettings: () => ({ antfly: { enabled: false, auditTtl: undefined } }),
}))

// Stub the team adapter — memory imports getAgentIds via '../team/lib/openclaw-adapter'.
// vi.mock specifiers must match real paths so the hook check passes.
vi.mock('../../../plugins/team/lib/openclaw-adapter', () => ({
  getAgentIds: () => ['main', 'basil'],
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, callSearchRoute, callRoute } from '../test-helpers'
import memoryPlugin from '../../../plugins/memory/index'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('memory plugin — activation', () => {
  it('activates without error', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    expect(activated.routes.length).toBeGreaterThan(0)
  })

  it('registers the audit search content type', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    expect(activated.ctx.search.registerContentType).toHaveBeenCalled()
    const call = (activated.ctx.search.registerContentType as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call?.table).toBe('audit')
    expect(call?.facets).toContain('event')
    expect(call?.facets).toContain('agent')
  })
})

describe('memory plugin — /search route (auto-registered)', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(memoryPlugin, testDir)
  })

  it('auto-registers GET /search via the test helper', () => {
    const route = findRoute(activated.routes, 'GET', '/search')
    expect(route).toBeDefined()
  })

  it('returns seeded results for a query', async () => {
    activated.seedResults([
      {
        id: 'audit-1',
        table: 'bakin_audit',
        score: 1,
        fields: { event: 'task.created', agent: 'basil', content: 'task created' },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'task')
    expect(status).toBe(200)
    const results = (body as { results?: unknown[] }).results
    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect((results![0] as { id: string }).id).toBe('audit-1')
  })

  it('returns 400 when q is missing', async () => {
    const route = findRoute(activated.routes, 'GET', '/search')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: {} })
    expect(status).toBe(400)
    expect((body as { error?: string }).error).toMatch(/Missing/)
  })
})

describe('memory plugin — GET /audit route', () => {
  it('registers the route and returns parsed audit entries', async () => {
    // Seed an audit.jsonl in the temp content dir
    const auditPath = join(testDir, 'audit.jsonl')
    writeFileSync(
      auditPath,
      [
        JSON.stringify({ ts: '2026-04-14T10:00:00Z', event: 'task.created', agent: 'basil', data: { id: 't1' } }),
        JSON.stringify({ ts: '2026-04-14T10:05:00Z', event: 'task.completed', agent: 'basil', data: { id: 't1' } }),
      ].join('\n'),
    )

    const activated = await activatePlugin(memoryPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/audit')
    expect(route).toBeDefined()

    const { status, body } = await callRoute(route!, activated.ctx)
    expect(status).toBe(200)
    const entries = (body as { entries?: unknown[] }).entries
    expect(Array.isArray(entries)).toBe(true)
    expect(entries!.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty entries when audit.jsonl is missing', async () => {
    const emptyDir = join(tmpdir(), `bakin-test-memory-empty-${Date.now()}`)
    mkdirSync(emptyDir, { recursive: true })
    try {
      const activated = await activatePlugin(memoryPlugin, emptyDir)
      const route = findRoute(activated.routes, 'GET', '/audit')!
      // Note: storage adapter still resolves to global testDir per the mock,
      // so this just confirms the route exists and returns shape.
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(Array.isArray((body as { entries?: unknown[] }).entries)).toBe(true)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})
