/**
 * Per-agent activity timeline (#385) — pure assembly (run spine + audit
 * interleave, death summarization, caps, log attachment) and the
 * GET /:agentId/timeline route over a real temp ledger + audit file.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-timeline-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
    db: join(testDir, 'bakin.db'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => ({ created: [], seeded: [] }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

// content-files reads getContentDir() at module top — stub the module
// (routes/agents.ts only pulls readHeartbeats from it).
mock.module('../../../src/lib/content-files', () => ({
  readHeartbeats: mock(() => ({})),
}))

import { assembleTimeline, TIMELINE_AUDIT_KINDS, type TimelineTaskInfo } from '../../../plugins/team/lib/timeline'
import { claimRun, settleRun, recordRunCost } from '../../../src/core/execution-ledger'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import { closeDb } from '../../../packages/core/src/storage/db'
import type { RunWithCostRow } from '../../../src/core/execution-ledger'

// routes/agents.ts transitively evaluates content-dir consumers at module
// top — load it dynamically AFTER the mocks above (same pattern as
// routes.test.ts).
const { populateAgentRoutes } = await import('../../../plugins/team/lib/routes/agents')

const NOW = 1_750_000_000_000

function run(overrides: Partial<RunWithCostRow> = {}): RunWithCostRow {
  return {
    runId: 'task:t1:d1',
    taskId: 't1',
    execKey: 't1',
    seq: 1,
    agent: 'pixel',
    status: 'settled',
    bootId: 'boot',
    startedAt: NOW - 200_000,
    heartbeatAt: NOW - 10_000,
    settledAt: NOW - 8_000,
    settleReason: 'turn-ok',
    model: 'sonnet-5',
    inputTokens: 41_000,
    outputTokens: 2_100,
    totalTokens: 43_100,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsdMicros: 40_000,
    workClass: 'adhoc',
    routeSource: 'class',
    ...overrides,
  }
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('assembleTimeline', () => {
  it('merges runs and audit events newest first with per-run logs attached', () => {
    const taskById = new Map<string, TimelineTaskInfo>([
      ['t1', {
        title: 'resize hero images',
        log: [
          { timestamp: new Date(NOW - 150_000).toISOString(), author: 'pixel', message: 'starting' },
          { timestamp: new Date(NOW - 100_000).toISOString(), author: 'pixel', message: 'halfway' },
          // outside the run window — must be excluded
          { timestamp: new Date(NOW - 500_000).toISOString(), author: 'pixel', message: 'old note' },
        ],
      }],
    ])
    const events = assembleTimeline({
      runs: [run()],
      auditEvents: [
        { ts: new Date(NOW - 50_000).toISOString(), event: 'task.bypass_detected', agent: 'pixel', data: { id: 't9' } },
      ],
      taskById,
      now: NOW,
    })

    expect(events.map((e) => e.type)).toEqual(['event', 'run'])
    const runEvent = events[1]!
    if (runEvent.type !== 'run') throw new Error('expected run event')
    expect(runEvent.taskTitle).toBe('resize hero images')
    expect(runEvent.durationMs).toBe(192_000)
    expect(runEvent.totalTokens).toBe(43_100)
    expect(runEvent.logs.map((l) => l.message)).toEqual(['starting', 'halfway'])
    const auditEvent = events[0]!
    if (auditEvent.type !== 'event') throw new Error('expected audit event')
    expect(auditEvent.severity).toBe('warn')
    expect(auditEvent.taskId).toBe('t9')
  })

  it('summarizes session deaths in plain language', () => {
    const events = assembleTimeline({
      runs: [],
      auditEvents: [{
        ts: new Date(NOW).toISOString(),
        event: 'task.runtime_session_died',
        agent: 'pixel',
        data: { id: 't1', title: 'weekly digest', reason: 'runtime_timeout', lastToolCall: 'browser_screenshot', deaths: 2 },
      }],
      taskById: new Map(),
      now: NOW,
    })
    const event = events[0]!
    if (event.type !== 'event') throw new Error('expected audit event')
    expect(event.message).toContain('runtime timeout')
    expect(event.message).toContain("'weekly digest'")
    expect(event.message).toContain('browser_screenshot')
    expect(event.message).toContain('death 2')
    expect(event.severity).toBe('warn')
  })

  it('a running run has null duration and stays on top', () => {
    const events = assembleTimeline({
      runs: [run({ status: 'running', settledAt: null, settleReason: null, startedAt: NOW - 5_000 })],
      auditEvents: [],
      taskById: new Map(),
      now: NOW,
    })
    const live = events[0]!
    if (live.type !== 'run') throw new Error('expected run event')
    expect(live.durationMs).toBeNull()
    expect(live.taskTitle).toBeNull()
  })

  it('caps runs and events', () => {
    const runs = Array.from({ length: 150 }, (_, i) =>
      run({ runId: `task:t${i}:d1`, taskId: `t${i}`, startedAt: NOW - i * 1000 }))
    const audits = Array.from({ length: 300 }, (_, i) => ({
      ts: new Date(NOW - i * 500).toISOString(),
      event: 'agent_pkg.lessons_retrieved',
      agent: 'pixel',
      data: {},
    }))
    const events = assembleTimeline({ runs, auditEvents: audits, taskById: new Map(), now: NOW })
    expect(events.filter((e) => e.type === 'run')).toHaveLength(100)
    expect(events.filter((e) => e.type === 'event')).toHaveLength(200)
  })
})

describe('GET /:agentId/timeline route', () => {
  const routes: any[] = []
  populateAgentRoutes(routes, { indexAgentStatic: () => {} })
  const route = routes.find((r) => r.path === '/:agentId/timeline' && r.method === 'GET')

  const tasks = createMockBakinTaskStore()

  async function call(agentId: string, window?: string) {
    const params = new URLSearchParams({ agentId, ...(window ? { window } : {}) })
    const req = new Request(`http://localhost/api/plugins/team/timeline?${params}`)
    const res: Response = await route.handler(req, { tasks } as never)
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('is registered', () => {
    expect(route).toBeDefined()
  })

  it('returns runs with tokens and interleaved warn events for the agent only', async () => {
    const task = await tasks.create({ title: 'render pdf', agent: 'pixel', createdBy: 'test' } as never)
    expect(claimRun({ runId: `task:${task.id}:d1`, taskId: task.id, seq: 1, agent: 'pixel', bootId: 'b', now: Date.now() - 60_000 })).toEqual({ claimed: true })
    expect(settleRun(`task:${task.id}:d1`, 'turn-ok')).toBe(true)
    recordRunCost({ workClass: null, runId: `task:${task.id}:d1`, taskId: task.id, agent: 'pixel', model: 'sonnet-5', totalTokens: 12_345, costUsdMicros: 999, occurredAt: Date.now() - 30_000 })
    // other-agent run must not leak
    expect(claimRun({ runId: 'task:other:d1', taskId: 'other', seq: 1, agent: 'scout', bootId: 'b' })).toEqual({ claimed: true })

    writeFileSync(join(testDir, 'audit.jsonl'), [
      // watchdog-actor bypass: top-level agent is 'watchdog', the offending
      // agent lives in data.agent — the production emit shape (watchdog.ts).
      JSON.stringify({ ts: new Date(Date.now() - 20_000).toISOString(), event: 'task.bypass_detected', agent: 'watchdog', data: { id: task.id, agent: 'pixel', pattern: 'native image' } }),
      JSON.stringify({ ts: new Date(Date.now() - 15_000).toISOString(), event: 'task.bypass_detected', agent: 'watchdog', data: { id: 'other', agent: 'scout' } }),
      JSON.stringify({ ts: new Date(Date.now() - 10_000).toISOString(), event: 'agent_pkg.lessons_retrieved', agent: 'pixel', data: { taskId: task.id, lessons: [{ lessonId: 'style' }] } }),
      JSON.stringify({ ts: new Date(Date.now() - 5_000).toISOString(), event: 'task.completed', agent: 'pixel', data: { id: task.id } }), // not a timeline kind
    ].join('\n') + '\n')

    const { status, body } = await call('pixel')
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
    const events = body.events as Array<Record<string, unknown>>
    const runEvents = events.filter((e) => e.type === 'run')
    const auditEvents = events.filter((e) => e.type === 'event')
    expect(runEvents).toHaveLength(1)
    expect(runEvents[0]).toMatchObject({ taskTitle: 'render pdf', totalTokens: 12_345, model: 'sonnet-5', status: 'settled' })
    // pixel's watchdog-attributed bypass + its lessons event; scout's bypass excluded
    expect(auditEvents).toHaveLength(2)
    const bypass = auditEvents.find((e) => e.event === 'task.bypass_detected')!
    expect(bypass.message).toContain('Bypassed the preferred tool path')
    expect(bypass.message).toContain('native image')
    const lessons = auditEvents.find((e) => e.event === 'agent_pkg.lessons_retrieved')!
    expect(lessons.message).toContain('Retrieved 1 lesson(s)')
  })

  it('rejects a bad window', async () => {
    const { status } = await call('pixel', 'forever')
    expect(status).toBe(400)
  })
})

describe('TIMELINE_AUDIT_KINDS', () => {
  it('covers the D10 events (bypass + lessons) and the failure ladder', () => {
    expect(TIMELINE_AUDIT_KINDS).toContain('task.bypass_detected')
    expect(TIMELINE_AUDIT_KINDS).toContain('agent_pkg.lessons_retrieved')
    expect(TIMELINE_AUDIT_KINDS).toContain('task.runtime_session_died')
    expect(TIMELINE_AUDIT_KINDS).toContain('task.corrective_redispatch')
  })
})
