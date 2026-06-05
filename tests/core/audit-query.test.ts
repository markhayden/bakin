import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
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
    expect(all.length).toBe(5)
    expect(queryAuditEvents(testDir, { limit: 2 }).length).toBe(2)
  })

  it('returns [] for a missing audit file', () => {
    expect(queryAuditEvents(join(testDir, 'nope'))).toEqual([])
  })
})

describe('session-death-incidents health check', () => {
  it('warns with task/agent/size details when deaths occurred in the last 24h', () => {
    const results = checkSessionDeathIncidents(testDir, queryAuditEvents)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ check: 'session-death-incidents', status: 'warn' })
    expect(results[0]?.message).toContain('2 runtime session death(s)')
    expect(results[0]?.message).toContain('t-100 (jessica, 692KB, oversized)')
    expect(results[0]?.message).toContain('t-200 (jessica, 549KB, oversized)')
  })

  it('reports ok when the window is clean', () => {
    const cleanDir = join(testDir, 'clean')
    mkdirSync(cleanDir, { recursive: true })
    writeFileSync(join(cleanDir, 'audit.jsonl'), entry('task.dispatched', 1000, { id: 't-x' }) + '\n')
    const results = checkSessionDeathIncidents(cleanDir, queryAuditEvents)
    expect(results[0]).toMatchObject({ check: 'session-death-incidents', status: 'ok' })
  })
})
