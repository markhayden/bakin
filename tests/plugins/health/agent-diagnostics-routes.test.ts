/**
 * Health plugin #385 routes — /live-now (in-flight runs), /agent-effort
 * (effort vs outcome with the attributed/observed/unattributed delta), and
 * the /usage-history byAgentDay cross-tab.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-agent-diag-routes-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
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

mock.module('../../../src/core/doctor', () => ({
  getLastReport: () => null,
  runDiagnostics: async () => null,
  runTargetedDiagnostics: async () => null,
}))
mock.module('../../../src/core/doctor-repair', () => ({
  planDoctorRepair: async () => ({ items: [], errors: [] }),
  applyDoctorRepair: async () => ({ status: 'applied' }),
}))
mock.module('../../../src/core/doctor-delegate', () => ({
  delegateDoctorRepair: async () => ({ status: 'sent' }),
  verifyDoctorRepairRequest: async () => ({ verified: true }),
}))
mock.module('../../../src/core/doctor-repair-store', () => ({
  DoctorRepairRequestNotFoundError: class DoctorRepairRequestNotFoundError extends Error {},
  listDoctorRepairRequests: () => [],
  getDoctorRepairRequest: () => null,
}))

import healthPlugin from '../../../plugins/health'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import { stopUsageHistoryTimer } from '../../../plugins/health/lib/usage-history-timer'
import { replaceSessionUsage, toLocalDayKey } from '@bakin/core/usage-history/store'
import { claimRun, settleRun, recordRunCost, recordCompletion } from '../../../src/core/execution-ledger'
import { closeAllDbs } from '@bakin/core/storage/db'

let activated: ActivatedPlugin
const usageScanGlobal = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
}

const NOW = Date.now()
const today = toLocalDayKey(NOW)

beforeAll(async () => {
  usageScanGlobal.__bakinUsageHistoryLastScan = null
  activated = await activatePlugin(healthPlugin, testDir)
})

afterAll(() => {
  stopUsageHistoryTimer()
  usageScanGlobal.__bakinUsageHistoryLastScan = null
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

async function get(path: string, searchParams: Record<string, string> = {}) {
  const route = findRoute(activated.routes, 'GET', path)
  if (!route) throw new Error(`route ${path} not registered`)
  return callRoute(route, activated.ctx, { searchParams })
}

describe('GET /live-now', () => {
  it('empty ledger → honest empty state', async () => {
    const { status, body } = await get('/live-now')
    expect(status).toBe(200)
    expect(body.runs).toEqual([])
    expect(typeof body.generatedAt).toBe('string')
  })

  it('shows a running run with task title, running-for and heartbeat age', async () => {
    const task = await activated.ctx.tasks.create({
      title: 'resize hero images',
      agent: 'pixel',
      createdBy: 'test',
    } as never)
    expect(claimRun({
      runId: `task:${task.id}:d1`,
      taskId: task.id,
      seq: 1,
      agent: 'pixel',
      bootId: 'boot-live',
      now: NOW - 60_000,
    })).toEqual({ claimed: true })

    const { body } = await get('/live-now')
    const runs = body.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ agent: 'pixel', taskId: task.id, taskTitle: 'resize hero images' })
    expect(runs[0]!.runningForMs as number).toBeGreaterThanOrEqual(60_000)
    expect(runs[0]!.heartbeatAgeMs as number).toBeGreaterThanOrEqual(0)

    // settle → disappears
    expect(settleRun(`task:${task.id}:d1`, 'turn-ok')).toBe(true)
    const after = await get('/live-now')
    expect(after.body.runs).toEqual([])
  })

  it('keeps an expected purged task as an honest null title', async () => {
    expect(claimRun({
      runId: 'task:purged:d1',
      taskId: 'purged',
      seq: 1,
      agent: 'pixel',
      bootId: 'boot-live',
      now: NOW - 30_000,
    })).toEqual({ claimed: true })

    try {
      const { status, body } = await get('/live-now')
      expect(status).toBe(200)
      expect(body.runs).toEqual([
        expect.objectContaining({ taskId: 'purged', taskTitle: null }),
      ])
    } finally {
      settleRun('task:purged:d1', 'turn-ok')
    }
  })

  it('does not describe a task-store failure as a purged task', async () => {
    expect(claimRun({
      runId: 'task:store-failure:d1',
      taskId: 'store-failure',
      seq: 1,
      agent: 'pixel',
      bootId: 'boot-live',
      now: NOW - 30_000,
    })).toEqual({ claimed: true })
    const originalGet = activated.ctx.tasks.get
    activated.ctx.tasks.get = async () => {
      throw new Error('task store unavailable')
    }

    try {
      const { status, body } = await get('/live-now')
      expect(status).toBe(500)
      expect(body.error).toBe('Live run details are unavailable.')
      expect(body.runs).toBeUndefined()
    } finally {
      activated.ctx.tasks.get = originalGet
      settleRun('task:store-failure:d1', 'turn-error')
    }
  })
})

describe('GET /agent-effort', () => {
  it('joins attributed, observed, and unattributed per agent', async () => {
    // Attributed: 200k tokens across 2 runs, 1 completion.
    recordRunCost({ runId: 'task:e1:d1', taskId: 'e1', agent: 'pixel', totalTokens: 150_000, costUsdMicros: 30_000, occurredAt: NOW - 3_600_000 })
    recordRunCost({ runId: 'task:e2:d1', taskId: 'e2', agent: 'pixel', totalTokens: 50_000, costUsdMicros: 10_000, occurredAt: NOW - 1_800_000 })
    recordCompletion('e1', { agent: 'pixel', now: NOW - 3_500_000 })
    // Observed: 1M today → 800k unattributed (>50% share, >100k floor).
    replaceSessionUsage('sess-pixel', 'pixel', [{
      day: today,
      model: 'm1',
      inputTokens: 900_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1_000_000,
      costUsdMicros: null,
      costedMessages: 0,
      messageCount: 4,
      firstTs: NOW - 3_000_000,
      lastTs: NOW - 60_000,
    }], { mtimeMs: 1, size: 1 })
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: NOW,
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'pixel', status: 'complete' }],
        },
      },
    }

    const { status, body } = await get('/agent-effort')
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
    expect(body.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.throughDay).toBe(today)
    expect(body.scopeLabel).toBe(`${body.since as string} through ${today}`)
    expect(body.coverage).toEqual({
      status: 'complete',
      reason: 'complete',
      agents: [{ agent: 'pixel', status: 'complete' }],
    })
    const rows = body.agents as Array<Record<string, unknown>>
    const pixel = rows.find((r) => r.agent === 'pixel')!
    expect(pixel).toMatchObject({
      windowTokens: 200_000,
      windowCostUsdMicros: 40_000,
      runs: 2,
      completions: 1,
      tokensPerCompletion: 200_000,
      totalObservedTokens: 1_000_000,
      unattributedTokens: 800_000,
    })
    const flags = pixel.flags as Array<{ kind: string }>
    expect(flags.map((f) => f.kind)).toEqual(['unattributed'])
  })

  it('rejects an unknown window with 400', async () => {
    const { status } = await get('/agent-effort', { window: 'forever' })
    expect(status).toBe(400)
  })
})

describe('GET /usage-history byAgentDay', () => {
  it('returns (agent × day) cells alongside the existing rollups', async () => {
    const { body } = await get('/usage-history', { window: '7d' })
    const cells = body.byAgentDay as Array<{ agent: string; day: string; tokens: { total: number } }>
    const pixelToday = cells.find((c) => c.agent === 'pixel' && c.day === today)
    expect(pixelToday?.tokens.total).toBe(1_000_000)
  })
})

describe('GET /agent-effort storage failure', () => {
  it('returns unavailable instead of evaluating an empty usage store as zero', async () => {
    closeAllDbs()
    const storePath = join(testDir, 'usage.db')
    rmSync(storePath, { force: true })
    mkdirSync(storePath)

    const { status, body } = await get('/agent-effort')

    expect(status).toBe(503)
    expect(body.error).toBe('Usage history store could not be read.')
    rmSync(storePath, { recursive: true, force: true })
  })
})
