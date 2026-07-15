/**
 * Usage-history scanner — session JSONL → durable per-(day, model) rows.
 * Integration-tests the scanner against the real store (temp usage.db) and a
 * fake runtime adapter, proving the #359 guarantees: no double-counting,
 * stat-skip, history survives source deletion, rewrites converge.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-usage-scan-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
import { scanUsageHistory, bucketSessionUsage } from '../../src/core/usage-history'
import { usageByAgentSince, usageByDaySince, toLocalDayKey } from '@bakin/core/usage-history/store'
import { closeAllDbs } from '@bakin/core/storage/db'

afterAll(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

interface FixtureSession {
  agentId: string
  id: string
  content: string
  mtimeMs: number
  size: number
}

const SESSION_TIER = 'runtime-session-jsonl'
const EPOCH_DAY = toLocalDayKey(0)

let sessions: FixtureSession[]
let getEntryCalls: number

function makeRuntime(): AgentRuntimeAdapter {
  const runtime = createMockRuntimeAdapter()
  runtime.agents.list = async () => {
    const ids = [...new Set(sessions.map((s) => s.agentId))]
    return ids.map((id) => ({ id, name: id, status: 'active' as const }))
  }
  runtime.memory.listTiers = async () => [
    { id: SESSION_TIER, label: 'Session transcripts', metadata: { sourceKind: 'session_jsonl' } },
  ]
  runtime.memory.listEntries = async (_tierId, opts) =>
    sessions.filter((s) => s.agentId === opts?.agentId).map(toEntry)
  runtime.memory.getEntry = async (_tierId, id, opts) => {
    getEntryCalls++
    const s = sessions.find((e) => e.agentId === opts?.agentId && e.id === id)
    return s ? toEntry(s) : null
  }
  runtime.memory.statEntry = async (_tierId, id, opts) => {
    const s = sessions.find((e) => e.agentId === opts?.agentId && e.id === id)
    return s ? { size: s.size, mtimeMs: s.mtimeMs } : null
  }
  return runtime
}

function toEntry(s: FixtureSession): RuntimeMemoryEntry {
  return { id: s.id, tierId: SESSION_TIER, agentId: s.agentId, path: s.id, content: s.content, metadata: {} }
}

function sessionLines(sessionId: string, startTs: string, msgs: Array<{ ts?: string; model?: string; input: number; output: number; cost?: number }>): string {
  const lines = [JSON.stringify({ type: 'session', id: sessionId, timestamp: startTs })]
  for (const m of msgs) {
    lines.push(
      JSON.stringify({
        type: 'message',
        ...(m.ts ? { timestamp: m.ts } : {}),
        message: {
          role: 'assistant',
          ...(m.model ? { model: m.model } : {}),
          usage: {
            input: m.input, output: m.output, cacheRead: 0, cacheWrite: 0,
            totalTokens: m.input + m.output,
            ...(m.cost !== undefined ? { cost: { total: m.cost } } : {}),
          },
        },
      }),
    )
  }
  return lines.join('\n') + '\n'
}

function addSession(agentId: string, id: string, content: string, mtimeMs = 1000) {
  sessions.push({ agentId, id, content, mtimeMs, size: content.length })
}

beforeEach(() => {
  sessions = []
  getEntryCalls = 0
  // Fresh store per test — the durability-across-reopen case lives in the
  // store's own test file; here every test assumes a clean slate.
  closeAllDbs()
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(testDir, `usage.db${suffix}`), { force: true })
  }
})

describe('scanUsageHistory', () => {
  it('no session tier → no-op report', async () => {
    const runtime = createMockRuntimeAdapter()
    runtime.memory.listTiers = async () => []
    const report = await scanUsageHistory(runtime)
    expect(report).toEqual({
      scanned: 0,
      skipped: 0,
      failed: 0,
      coverage: {
        status: 'unavailable',
        reason: 'missing_session_tier',
        agents: [],
      },
    })
  })

  it('a roster read failure is unavailable evidence, not a complete zero', async () => {
    const runtime = createMockRuntimeAdapter()
    runtime.memory.listTiers = async () => [
      { id: SESSION_TIER, label: 'Session transcripts', metadata: { sourceKind: 'session_jsonl' } },
    ]
    runtime.agents.list = async () => { throw new Error('roster unavailable') }

    const report = await scanUsageHistory(runtime)

    expect(report.coverage).toEqual({
      status: 'unavailable',
      reason: 'roster_unavailable',
      agents: [],
    })
  })

  it('tracks session-scan completeness per agent instead of blessing the whole fleet', async () => {
    addSession('basil', 'ok', sessionLines('ok', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 5, output: 0 },
    ]))
    addSession('clover', 'broken', sessionLines('broken', '2026-07-01T11:00:00Z', [
      { ts: '2026-07-01T11:01:00Z', model: 'm1', input: 9, output: 0 },
    ]))
    const runtime = makeRuntime()
    const originalGetEntry = runtime.memory.getEntry
    runtime.memory.getEntry = async (tierId, id, opts) => {
      if (opts?.agentId === 'clover') throw new Error('session unreadable')
      return originalGetEntry(tierId, id, opts)
    }

    const report = await scanUsageHistory(runtime)

    expect(report.coverage).toEqual({
      status: 'partial',
      reason: 'agent_scan_failed',
      agents: [
        { agent: 'basil', status: 'complete' },
        { agent: 'clover', status: 'partial' },
      ],
    })
  })

  it('aggregates multiple sessions across multiple agents', async () => {
    addSession('basil', 'b1', sessionLines('b1', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 100, output: 50, cost: 0.01 },
    ]))
    addSession('basil', 'b2', sessionLines('b2', '2026-07-01T12:00:00Z', [
      { ts: '2026-07-01T12:01:00Z', model: 'm1', input: 200, output: 100 },
    ]))
    addSession('clover', 'c1', sessionLines('c1', '2026-07-01T13:00:00Z', [
      { ts: '2026-07-01T13:01:00Z', model: 'm2', input: 10, output: 5, cost: 0.002 },
    ]))

    const report = await scanUsageHistory(makeRuntime())
    expect(report).toMatchObject({
      scanned: 3,
      skipped: 0,
      failed: 0,
      coverage: { status: 'complete', reason: 'complete' },
    })

    const byAgent = usageByAgentSince(EPOCH_DAY)
    const basil = byAgent.find((a) => a.agent === 'basil')
    expect(basil?.tokens).toEqual({ input: 300, output: 150, cacheRead: 0, cacheWrite: 0, total: 450 })
    expect(basil?.costUsdMicros).toBe(10_000)
    expect(basil?.costedMessages).toBe(1)
    expect(basil?.messageCount).toBe(2)

    const clover = byAgent.find((a) => a.agent === 'clover')
    expect(clover?.tokens.total).toBe(15)
    expect(clover?.costUsdMicros).toBe(2_000)
  })

  it('rescan with unchanged mtime+size skips getEntry and never double-counts', async () => {
    addSession('basil', 'b1', sessionLines('b1', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 100, output: 50 },
    ]))
    const runtime = makeRuntime()

    await scanUsageHistory(runtime)
    const callsAfterFirst = getEntryCalls
    const second = await scanUsageHistory(runtime)

    expect(second).toMatchObject({
      scanned: 0,
      skipped: 1,
      failed: 0,
      coverage: { status: 'complete', reason: 'complete' },
    })
    expect(getEntryCalls).toBe(callsAfterFirst)
    expect(usageByAgentSince(EPOCH_DAY).find((a) => a.agent === 'basil')?.tokens.total).toBe(150)
  })

  it('a session spanning midnight lands in two day rows', async () => {
    addSession('basil', 'span', sessionLines('span', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T23:00:00Z', model: 'm1', input: 10, output: 0 },
      { ts: '2026-07-03T01:00:00Z', model: 'm1', input: 20, output: 0 },
    ]))
    await scanUsageHistory(makeRuntime())

    const days = usageByDaySince(EPOCH_DAY)
    // Timestamps chosen 2 days apart so they are distinct calendar days in
    // every timezone; each carries its own tokens.
    expect(days.length).toBe(2)
    const totals = days.map((d) => d.tokens.total).sort((a, b) => a - b)
    expect(totals).toEqual([10, 20])
  })

  it('rewritten (compacted) file converges to new content, no residue', async () => {
    addSession('basil', 'rw', sessionLines('rw', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 500, output: 500 },
      { ts: '2026-07-01T11:00:00Z', model: 'm1', input: 300, output: 300 },
    ]))
    const runtime = makeRuntime()
    await scanUsageHistory(runtime)
    expect(usageByAgentSince(EPOCH_DAY)[0].tokens.total).toBe(1600)

    // Compaction rewrote the file smaller with different content.
    sessions[0].content = sessionLines('rw', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 100, output: 100 },
    ])
    sessions[0].mtimeMs = 2000
    sessions[0].size = sessions[0].content.length

    const report = await scanUsageHistory(runtime)
    expect(report.scanned).toBe(1)
    expect(usageByAgentSince(EPOCH_DAY)[0].tokens.total).toBe(200)
  })

  it('deleted sessions keep their ingested history', async () => {
    addSession('basil', 'gone', sessionLines('gone', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 42, output: 0 },
    ]))
    const runtime = makeRuntime()
    await scanUsageHistory(runtime)

    sessions = [] // source deleted
    const report = await scanUsageHistory(runtime)
    expect(report).toMatchObject({
      scanned: 0,
      skipped: 0,
      failed: 0,
      coverage: { status: 'complete', reason: 'complete', agents: [] },
    })
    expect(usageByAgentSince(EPOCH_DAY).find((a) => a.agent === 'basil')?.tokens.total).toBe(42)
  })

  it('skips .deleted entries', async () => {
    addSession('basil', 'live', sessionLines('live', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 1, output: 0 },
    ]))
    addSession('basil', 'x.deleted.jsonl', sessionLines('x', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 999, output: 0 },
    ]))
    await scanUsageHistory(makeRuntime())
    expect(usageByAgentSince(EPOCH_DAY).find((a) => a.agent === 'basil')?.tokens.total).toBe(1)
  })

  it('messages without their own timestamp fall back to the session start day', async () => {
    addSession('basil', 'nots', sessionLines('nots', '2026-07-01T10:00:00Z', [
      { model: 'm1', input: 7, output: 0 }, // no per-message ts
    ]))
    await scanUsageHistory(makeRuntime())
    const days = usageByDaySince(EPOCH_DAY)
    expect(days).toHaveLength(1)
    expect(days[0].day).toBe(toLocalDayKey(Date.parse('2026-07-01T10:00:00Z')))
    expect(days[0].tokens.total).toBe(7)
  })

  it('one unreadable session fails alone; the sweep continues', async () => {
    addSession('basil', 'ok', sessionLines('ok', '2026-07-01T10:00:00Z', [
      { ts: '2026-07-01T10:01:00Z', model: 'm1', input: 5, output: 0 },
    ]))
    addSession('basil', 'boom', 'irrelevant')
    const runtime = makeRuntime()
    const origGetEntry = runtime.memory.getEntry
    runtime.memory.getEntry = async (tierId, id, opts) => {
      if (id === 'boom') throw new Error('io error')
      return origGetEntry(tierId, id, opts)
    }

    const report = await scanUsageHistory(runtime)
    expect(report.failed).toBe(1)
    expect(report.scanned).toBe(1)
    expect(usageByAgentSince(EPOCH_DAY).find((a) => a.agent === 'basil')?.tokens.total).toBe(5)
  })

  it('component-only cost sums like the latest-session card (no explicit total)', async () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 'cc', timestamp: '2026-07-01T10:00:00Z' }),
      JSON.stringify({
        type: 'message', timestamp: '2026-07-01T10:01:00Z',
        message: { role: 'assistant', model: 'm1', usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0.001, output: 0.002 } } },
      }),
    ].join('\n')
    addSession('basil', 'cc', lines)
    await scanUsageHistory(makeRuntime())
    const basil = usageByAgentSince(EPOCH_DAY).find((a) => a.agent === 'basil')
    expect(basil?.costUsdMicros).toBe(3_000)
    expect(basil?.costedMessages).toBe(1)
  })
})

describe('toLocalDayKey', () => {
  it('formats zero-padded local calendar days', () => {
    // 2026-03-05 12:00 local — construct from local components so the
    // assertion holds in every timezone.
    const ts = new Date(2026, 2, 5, 12, 0, 0).getTime()
    expect(toLocalDayKey(ts)).toBe('2026-03-05')
  })

  it('two timestamps on the same local day share a key; adjacent days differ', () => {
    const morning = new Date(2026, 6, 4, 0, 30).getTime()
    const night = new Date(2026, 6, 4, 23, 30).getTime()
    const nextDay = new Date(2026, 6, 5, 0, 30).getTime()
    expect(toLocalDayKey(morning)).toBe(toLocalDayKey(night))
    expect(toLocalDayKey(nextDay)).not.toBe(toLocalDayKey(morning))
  })
})

describe('bucketSessionUsage cost honesty', () => {
  it('an empty cost object is not runtime-reported cost', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'ec', timestamp: '2026-07-01T10:00:00Z' }),
      JSON.stringify({
        type: 'message', timestamp: '2026-07-01T10:01:00Z',
        message: { role: 'assistant', model: 'm1', usage: { input: 1, output: 1, totalTokens: 2, cost: {} } },
      }),
    ].join('\n')
    const rows = bucketSessionUsage(content)
    expect(rows).toHaveLength(1)
    expect(rows[0].costUsdMicros).toBeNull()
    expect(rows[0].costedMessages).toBe(0)
    expect(rows[0].messageCount).toBe(1)
  })
})
