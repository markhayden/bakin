import { describe, it, expect, beforeAll, afterAll, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-audit-query-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
// health-checks transitively imports the task store + app services — mock
// both so this test can't touch real task data.
mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: {} })),
  clearDependency: mock(async () => undefined),
  reorderTasks: mock(async () => undefined),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: {} })),
  clearDependency: mock(async () => undefined),
  reorderTasks: mock(async () => undefined),
}))
mock.module('../../src/core/app-services', () => ({
  maybeGetAppServices: () => null,
}))
mock.module('../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => null,
}))

import { queryAuditEvents } from '../../src/core/audit'
import { checkSessionDeathIncidents } from '../../plugins/tasks/lib/health-checks'

function entry(event: string, agoMs: number, data: Record<string, unknown> = {}, agent = 'jessica'): string {
  return JSON.stringify({ ts: new Date(Date.now() - agoMs).toISOString(), event, agent, data })
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'audit.jsonl'), [
    entry('task.dispatched', 30 * 60 * 1000, { id: 't-1' }),
    entry('task.runtime_session_died', 2 * 60 * 60 * 1000, { id: 't-100', completionBytes: 708567, oversizedOutput: true }),
    'this line is not json',
    entry('task.runtime_session_died', 26 * 60 * 60 * 1000, { id: 't-old', completionBytes: 999 }), // outside 24h
    entry('task.runtime_session_died', 10 * 60 * 1000, { id: 't-200', completionBytes: 562593, oversizedOutput: true }),
    entry('task.completed', 5 * 60 * 1000, { id: 't-1' }),
    entry('task.dispatched', 4 * 60 * 1000, { id: 't-2' }, 'pixel'),
    entry('task.completed', 3 * 60 * 1000, { id: 't-2' }, 'pixel'),
  ].join('\n') + '\n')
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('queryAuditEvents', () => {
  it('filters by kind and recency, tolerating malformed lines', () => {
    const deaths = queryAuditEvents(testDir, {
      kinds: ['task.runtime_session_died'],
      sinceMs: 24 * 60 * 60 * 1000,
    })
    expect(deaths.length).toBe(2)
    expect(deaths.map((d) => d.data.id)).toEqual(['t-100', 't-200'])
  })

  it('returns everything without filters and respects limit', () => {
    const all = queryAuditEvents(testDir)
    expect(all.length).toBe(7)
    expect(queryAuditEvents(testDir, { limit: 2 }).length).toBe(2)
  })

  it('returns [] for a missing audit file', () => {
    expect(queryAuditEvents(join(testDir, 'nope'))).toEqual([])
  })

  it('filters by agent on the full-read path (#385)', () => {
    const pixel = queryAuditEvents(testDir, { agent: 'pixel' })
    expect(pixel.map((e) => e.event)).toEqual(['task.dispatched', 'task.completed'])
    expect(pixel.every((e) => e.agent === 'pixel')).toBe(true)
    expect(queryAuditEvents(testDir, { agent: 'nobody' })).toEqual([])
  })

  it('filters by agent on the windowed tail path, composing with kinds (#385)', () => {
    const pixel = queryAuditEvents(testDir, { agent: 'pixel', sinceMs: 24 * 60 * 60 * 1000 })
    expect(pixel.map((e) => e.data.id)).toEqual(['t-2', 't-2'])

    const completed = queryAuditEvents(testDir, {
      agent: 'pixel',
      kinds: ['task.completed'],
      sinceMs: 24 * 60 * 60 * 1000,
    })
    expect(completed.length).toBe(1)
    expect(completed[0]!.agent).toBe('pixel')

    // jessica's events are untouched by pixel's filter
    const jessica = queryAuditEvents(testDir, { agent: 'jessica', sinceMs: 24 * 60 * 60 * 1000 })
    expect(jessica.length).toBe(4)
  })
})

describe('queryAuditEvents — reverse tail read equivalence', () => {
  // Reference implementation: the original full-file read + filter. The
  // sinceMs fast path must be result-identical to this on any fixture.
  function referenceQuery(
    raw: string,
    opts: { kinds?: string[]; sinceMs?: number; limit?: number },
  ): Array<Record<string, unknown>> {
    const kinds = opts.kinds ? new Set(opts.kinds) : null
    const cutoff = opts.sinceMs !== undefined ? Date.now() - opts.sinceMs : null
    const results: Array<Record<string, unknown>> = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let e: Record<string, unknown>
      try { e = JSON.parse(trimmed) } catch { continue }
      if (typeof e?.event !== 'string' || typeof e?.ts !== 'string') continue
      if (kinds && !kinds.has(e.event as string)) continue
      if (cutoff !== null) {
        const tsMs = Date.parse(e.ts as string)
        if (Number.isNaN(tsMs) || tsMs < cutoff) continue
      }
      results.push(e)
    }
    return opts.limit !== undefined ? results.slice(-opts.limit) : results
  }

  const bigDir = join(tmpdir(), `bakin-test-audit-tail-${Date.now()}`)
  let bigRaw = ''

  beforeAll(() => {
    mkdirSync(bigDir, { recursive: true })
    const lines: string[] = []
    // ~3000 entries ≈ several 64KB chunks; oldest first, monotonic, spanning
    // the 24h cutoff. Multi-byte content (emoji) ensures UTF-8 chunk splits
    // are handled at the buffer level. A malformed line sits mid-tail.
    for (let i = 0; i < 3000; i++) {
      const agoMs = (3000 - i) * 60 * 1000 // 50h .. 1min ago
      const event = i % 3 === 0 ? 'task.dispatched' : i % 3 === 1 ? 'task.completed' : 'task.runtime_session_died'
      lines.push(JSON.stringify({
        ts: new Date(Date.now() - agoMs).toISOString(),
        event,
        agent: 'jessica',
        data: { id: `t-${i}`, note: `padding 📦🚀 ${'x'.repeat(40)}` },
      }))
      if (i === 2700) lines.push('{ this is not valid json 🤖')
    }
    bigRaw = lines.join('\n') + '\n'
    writeFileSync(join(bigDir, 'audit.jsonl'), bigRaw)
  })

  afterAll(() => rmSync(bigDir, { recursive: true, force: true }))

  it('matches the full-read reference for a 24h window', () => {
    const opts = { sinceMs: 24 * 60 * 60 * 1000 }
    const got = queryAuditEvents(bigDir, opts)
    const want = referenceQuery(bigRaw, opts)
    expect(got.length).toBeGreaterThan(0)
    expect(got).toEqual(want as never)
  })

  it('matches the reference with kinds + limit (newest-limit, oldest-first)', () => {
    const opts = { kinds: ['task.runtime_session_died'], sinceMs: 24 * 60 * 60 * 1000, limit: 7 }
    const got = queryAuditEvents(bigDir, opts)
    const want = referenceQuery(bigRaw, opts)
    expect(got).toHaveLength(7)
    expect(got).toEqual(want as never)
    // Oldest-first within the slice.
    expect(Date.parse(got[0]!.ts)).toBeLessThan(Date.parse(got[6]!.ts))
  })

  it('matches the reference for a window that spans the whole file', () => {
    const opts = { sinceMs: 100 * 60 * 60 * 1000 }
    expect(queryAuditEvents(bigDir, opts)).toEqual(referenceQuery(bigRaw, opts) as never)
  })

  it('matches the reference for a tiny window (single trailing chunk)', () => {
    const opts = { sinceMs: 30 * 60 * 1000 }
    expect(queryAuditEvents(bigDir, opts)).toEqual(referenceQuery(bigRaw, opts) as never)
  })

  it('a windowed query does not read the entire file', async () => {
    const fs = await import('fs')
    const readFileSpy = spyOn(fs, 'readFileSync')
    readFileSpy.mockClear()
    queryAuditEvents(bigDir, { sinceMs: 30 * 60 * 1000 })
    // The tail path uses fd-based chunk reads, never a whole-file readFileSync.
    const auditReads = readFileSpy.mock.calls.filter((c) => String(c[0]).endsWith('audit.jsonl'))
    expect(auditReads).toHaveLength(0)
    readFileSpy.mockRestore()
  })
})

describe('session-death-incidents health check', () => {
  it('warns with task/agent/size details when deaths occurred in the last 24h', () => {
    const result = checkSessionDeathIncidents(testDir, queryAuditEvents)
    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]).toMatchObject({
      key: 'recent',
      status: 'warning',
      summary: '2 runtime session deaths occurred in the last 24 hours.',
      evidence: {
        count: 2,
        recent: [
          { taskId: 't-100', agentId: 'jessica', completionBytes: expect.any(Number), oversizedOutput: true },
          { taskId: 't-200', agentId: 'jessica', completionBytes: expect.any(Number), oversizedOutput: true },
        ],
      },
      incident: { disposition: 'watch' },
    })
  })

  it('reports ok when the window is clean', () => {
    const cleanDir = join(testDir, 'clean')
    mkdirSync(cleanDir, { recursive: true })
    writeFileSync(join(cleanDir, 'audit.jsonl'), entry('task.dispatched', 1000, { id: 't-x' }) + '\n')
    const result = checkSessionDeathIncidents(cleanDir, queryAuditEvents)
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations[0]).toMatchObject({ key: 'recent', status: 'healthy' })
  })
})
