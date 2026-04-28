/**
 * Global-search integration test (C9-b).
 *
 * Proves the unified `bakin_memory` table surfaces mixed-tier results through
 * the plugin's auto-wired GET /search route. This is the cross-tier promise
 * of the rebuild: a single query spans sessions, daily notes, audit, etc.,
 * and the UI can discriminate via the `tier` facet on each row.
 *
 * We seed the mocked ctx.search.query with rows from three distinct tiers
 * and assert that all three round-trip through the plugin's search route
 * unchanged — row id, tier facet, agent, and meta all preserved.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-global-search-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-global-search-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-global-search-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({
  watchFiles: mock(),
}))
mock.module('../../../packages/core/src/openclaw-home', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-global-search-mock`, 'openclaw')
  return {
    getOpenClawHome: () => base,
    getOpenClawPath: (...parts: string[]) => j(base, ...parts),
  }
})
mock.module('../../../packages/core/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    runtime: {
      adapter: 'openclaw',
      settings: {},
    },
    antfly: { auditTtl: null },
  }),
}))

import { activatePlugin, callSearchRoute } from '../test-helpers'
import memoryPlugin from '../../../plugins/memory/index'
import type { SearchResult } from '../../../src/lib/plugin-types'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// Fixtures model the indexer's canonical row shape across three tiers.
// meta is JSON-stringified (matches how writeRow persists it).
const sessionRow: SearchResult = {
  id: 'session:abc123',
  table: 'bakin_memory',
  score: 0.94,
  fields: {
    tier: 'session',
    agent: 'explorer',
    title: 'Session: embedding benchmarks',
    snippet: 'Compared BM25 vs embedding recall on the daily-notes corpus.',
    content: 'Full transcript content about embedding benchmarks...',
    source_backend: 'filesystem',
    source_path: '/openclaw/agents/explorer/sessions/abc123.jsonl',
    updated_at: '2026-04-17T10:00:00.000Z',
    meta: JSON.stringify({ turnCount: 42, sessionId: 'abc123' }),
  },
}
const dailyNoteRow: SearchResult = {
  id: 'daily_note:explorer:2026-04-17',
  table: 'bakin_memory',
  score: 0.88,
  fields: {
    tier: 'daily_note',
    agent: 'explorer',
    title: 'Daily note 2026-04-17',
    snippet: 'Noted that embedding recall outperforms BM25 at k=10.',
    content: 'Full markdown body of the daily note...',
    source_backend: 'filesystem',
    source_path: '/openclaw/workspaces/explorer/memory/daily/2026-04-17.md',
    updated_at: '2026-04-17T23:00:00.000Z',
    meta: JSON.stringify({ date: '2026-04-17' }),
  },
}
const auditRow: SearchResult = {
  id: 'audit:7f3e9a',
  table: 'bakin_memory',
  score: 0.72,
  fields: {
    tier: 'audit',
    agent: 'explorer',
    title: 'task.complete',
    snippet: 'explorer completed "embedding benchmark" task',
    content: 'audit event payload json...',
    source_backend: 'filesystem',
    source_path: '/bakin/audit.jsonl',
    updated_at: '2026-04-17T10:15:00.000Z',
    meta: JSON.stringify({ eventType: 'task.complete', taskId: 't_9' }),
  },
}

describe('memory plugin — cross-tier global search (C9-b)', () => {
  it('returns mixed-tier rows from a single query', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    activated.seedResults([sessionRow, dailyNoteRow, auditRow])

    const { status, body } = await callSearchRoute(activated, 'embedding')

    expect(status).toBe(200)
    const results = body.results as SearchResult[]
    expect(results).toHaveLength(3)

    const tiers = new Set(results.map((r) => r.fields.tier as string))
    expect(tiers).toEqual(new Set(['session', 'daily_note', 'audit']))

    const meta = body.meta as { query: string; total: number }
    expect(meta.query).toBe('embedding')
    expect(meta.total).toBe(3)
  })

  it('preserves row id, tier, agent, and meta through the route', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    activated.seedResults([sessionRow, dailyNoteRow, auditRow])

    const { body } = await callSearchRoute(activated, 'embedding')
    const results = body.results as SearchResult[]

    const byId = new Map(results.map((r) => [r.id, r]))
    expect(byId.get('session:abc123')?.fields.agent).toBe('explorer')
    expect(byId.get('daily_note:explorer:2026-04-17')?.fields.tier).toBe('daily_note')
    expect(byId.get('audit:7f3e9a')?.fields.tier).toBe('audit')

    // meta survives as a string payload — consumers JSON.parse it.
    const sessionMeta = JSON.parse(byId.get('session:abc123')!.fields.meta as string)
    expect(sessionMeta).toEqual({ turnCount: 42, sessionId: 'abc123' })
  })

  it('passes the caller-supplied facets down to ctx.search.query', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    activated.seedResults([sessionRow])

    await callSearchRoute(activated, 'embedding', { facets: 'tier,agent' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'embedding',
        facets: ['tier', 'agent'],
      }),
    )
  })

  it('returns an empty result set for a query that matches no rows', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    activated.seedResults([])

    const { status, body } = await callSearchRoute(activated, 'zzz-never-matches')

    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect((body.meta as { total: number }).total).toBe(0)
  })

  it('returns 400 when q is missing', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    activated.seedResults([sessionRow])

    const { status, body } = await callSearchRoute(activated, '')

    expect(status).toBe(400)
    expect(body.error).toBe('Missing ?q= parameter')
  })
})
