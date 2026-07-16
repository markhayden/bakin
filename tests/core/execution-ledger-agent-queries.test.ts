/**
 * Agent-scoped ledger queries (#385): listLiveRuns (cross-agent running
 * snapshot), listRunsByAgent (run spine LEFT JOIN run_costs), and
 * completionsByAgentSince (effort-vs-outcome denominator).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-ledger-agent-${Date.now()}-${randomUUID()}`)

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

import {
  claimRun,
  settleRun,
  recordRunCost,
  recordCompletion,
  listLiveRuns,
  listRunsByAgent,
  completionsByAgentSince,
  runTokensByAgentSince,
  listRunCostsSince,
} from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const BOOT = 'boot-test-1'
const T0 = 1_750_000_000_000

function claim(taskId: string, seq: number, agent: string, now: number) {
  return claimRun({ runId: `task:${taskId}:d${seq}`, taskId, seq, agent, bootId: BOOT, now })
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('listLiveRuns', () => {
  it('lists only running rows across agents, oldest first', () => {
    expect(claim('live-a', 1, 'pixel', T0 + 2000)).toEqual({ claimed: true })
    expect(claim('live-b', 1, 'scout', T0 + 1000)).toEqual({ claimed: true })
    expect(claim('done-c', 1, 'pixel', T0)).toEqual({ claimed: true })
    expect(settleRun('task:done-c:d1', 'turn-ok')).toBe(true)

    const live = listLiveRuns()
    expect(live.map((r) => r.taskId)).toEqual(['live-b', 'live-a'])
    expect(live.every((r) => r.status === 'running')).toBe(true)
    expect(live[0]!.agent).toBe('scout')
    expect(live[0]!.heartbeatAt).toBe(T0 + 1000)

    // free the slots so later suites see a clean live set
    expect(settleRun('task:live-a:d1', 'turn-ok')).toBe(true)
    expect(settleRun('task:live-b:d1', 'turn-ok')).toBe(true)
    expect(listLiveRuns()).toEqual([])
  })
})

describe('listRunsByAgent', () => {
  it('joins runs with their cost rows, newest first, scoped to the agent', () => {
    expect(claim('j1', 1, 'joiner', T0 + 1000)).toEqual({ claimed: true })
    expect(settleRun('task:j1:d1', 'turn-ok', T0 + 5000)).toBe(true)
    recordRunCost({
      runId: 'task:j1:d1',
      taskId: 'j1',
      agent: 'joiner',
      model: 'sonnet-5',
      inputTokens: 41_000,
      outputTokens: 2_100,
      totalTokens: 43_100,
      costUsdMicros: 40_000,
      occurredAt: T0 + 5000,
    })
    // second run has no cost row (unmetered) — must still appear with nulls
    expect(claim('j2', 1, 'joiner', T0 + 10_000)).toEqual({ claimed: true })
    expect(settleRun('task:j2:d1', 'turn-error', T0 + 11_000)).toBe(true)
    // other agent's run never leaks in
    expect(claim('j3', 1, 'other', T0 + 12_000)).toEqual({ claimed: true })
    expect(settleRun('task:j3:d1', 'turn-ok')).toBe(true)

    const rows = listRunsByAgent('joiner')
    expect(rows.map((r) => r.taskId)).toEqual(['j2', 'j1'])

    const [unmetered, metered] = rows
    expect(unmetered!.settleReason).toBe('turn-error')
    expect(unmetered!.model).toBeNull()
    expect(unmetered!.totalTokens).toBeNull()
    expect(unmetered!.costUsdMicros).toBeNull()

    expect(metered!.status).toBe('settled')
    expect(metered!.model).toBe('sonnet-5')
    expect(metered!.inputTokens).toBe(41_000)
    expect(metered!.outputTokens).toBe(2_100)
    expect(metered!.costUsdMicros).toBe(40_000)
    expect(metered!.settledAt).toBe(T0 + 5000)
  })

  it('honors sinceMs and limit', () => {
    expect(listRunsByAgent('joiner', { sinceMs: T0 + 9000 }).map((r) => r.taskId)).toEqual(['j2'])
    expect(listRunsByAgent('joiner', { limit: 1 }).map((r) => r.taskId)).toEqual(['j2'])
    expect(listRunsByAgent('nobody')).toEqual([])
  })
})

describe('runTokensByAgentSince', () => {
  it('normalizes token components and excludes media from token coverage', () => {
    recordRunCost({ runId: 'turn:r1', agent: 'meter', usageKind: 'tokens', totalTokens: 100, costUsdMicros: 5, occurredAt: T0 + 1 })
    recordRunCost({ runId: 'turn:r2', agent: 'meter', usageKind: 'tokens', inputTokens: 30, outputTokens: 10, costUsdMicros: null, occurredAt: T0 + 2 })
    recordRunCost({ runId: 'image:r3', agent: 'meter', usageKind: 'media', totalTokens: null, costUsdMicros: 7, occurredAt: T0 + 3 })
    recordRunCost({ runId: 'turn:r4', agent: 'ghost', usageKind: 'tokens', totalTokens: null, costUsdMicros: null, occurredAt: T0 + 4 })
    recordRunCost({ runId: 'image:r5', agent: 'media-only', usageKind: 'media', totalTokens: null, costUsdMicros: null, occurredAt: T0 + 5 })

    const rows = runTokensByAgentSince(T0)
    const meter = rows.find((r) => r.agent === 'meter')
    expect(meter).toMatchObject({
      totalTokens: 140,
      costUsdMicros: 12,
      runs: 3,
      tokenApplicableRuns: 2,
      tokenMeteredRuns: 2,
      tokenAggregateRepresentable: true,
      costedRuns: 2,
      costAggregateRepresentable: true,
    })
    const ghost = rows.find((r) => r.agent === 'ghost')
    expect(ghost).toMatchObject({
      totalTokens: null,
      costUsdMicros: null,
      runs: 1,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 0,
      costedRuns: 0,
    })
    expect(rows.find((r) => r.agent === 'media-only')).toMatchObject({
      totalTokens: 0,
      costUsdMicros: null,
      runs: 1,
      tokenApplicableRuns: 0,
      tokenMeteredRuns: 0,
      costedRuns: 0,
    })
    expect(runTokensByAgentSince(T0 + 60_000).find((r) => r.agent === 'meter')).toBeUndefined()
  })

  it('rejects an invalid usage kind instead of dropping the row from both coverage buckets', () => {
    expect(() => recordRunCost({
      runId: 'turn:bad-kind',
      agent: 'meter',
      usageKind: 'other' as 'tokens',
      totalTokens: 1,
      occurredAt: T0 + 10,
    })).toThrow('invalid run usage kind')
  })

  it('stores malformed token evidence as unknown so rollups stay schema-safe', () => {
    const rows = [
      { runId: 'turn:negative', totalTokens: -1 },
      { runId: 'turn:fractional', totalTokens: 1.5 },
      { runId: 'turn:infinite', totalTokens: Number.POSITIVE_INFINITY },
      { runId: 'turn:unsafe', totalTokens: Number.MAX_SAFE_INTEGER + 1 },
      { runId: 'turn:bad-component', inputTokens: -1, outputTokens: 2 },
    ]
    for (const [index, row] of rows.entries()) {
      recordRunCost({
        ...row,
        agent: 'invalid-evidence',
        usageKind: 'tokens',
        occurredAt: T0 + 100 + index,
      })
    }

    const persisted = listRunCostsSince(T0)
      .filter((row) => row.agent === 'invalid-evidence')
    expect(persisted).toHaveLength(5)
    expect(persisted.every((row) => row.totalTokens === null)).toBe(true)
    expect(runTokensByAgentSince(T0).find((row) => row.agent === 'invalid-evidence')).toMatchObject({
      totalTokens: null,
      runs: 5,
      tokenApplicableRuns: 5,
      tokenMeteredRuns: 0,
    })
  })

  it('withholds a contradictory explicit total instead of publishing a false zero', () => {
    recordRunCost({
      runId: 'turn:contradictory-total',
      agent: 'contradictory-total',
      usageKind: 'tokens',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 0,
      occurredAt: T0 + 190,
    })

    expect(listRunCostsSince(T0).find((row) => row.runId === 'turn:contradictory-total')).toMatchObject({
      totalTokens: null,
    })
    expect(runTokensByAgentSince(T0).find((row) => row.agent === 'contradictory-total')).toMatchObject({
      totalTokens: null,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 0,
    })
  })

  it('withholds unsafe token and cost aggregates while preserving honest coverage counts', () => {
    for (let index = 0; index < 2; index++) {
      recordRunCost({
        runId: `turn:unsafe-aggregate:${index}`,
        agent: 'unsafe-aggregate',
        usageKind: 'tokens',
        totalTokens: Number.MAX_SAFE_INTEGER,
        costUsdMicros: Number.MAX_SAFE_INTEGER,
        occurredAt: T0 + 195 + index,
      })
    }

    expect(runTokensByAgentSince(T0).find((row) => row.agent === 'unsafe-aggregate')).toMatchObject({
      totalTokens: null,
      costUsdMicros: null,
      runs: 2,
      tokenApplicableRuns: 2,
      tokenMeteredRuns: 2,
      tokenAggregateRepresentable: false,
      costedRuns: 2,
      costAggregateRepresentable: false,
    })
  })

  it('stores malformed micro-dollar evidence as unpriced', () => {
    recordRunCost({
      runId: 'turn:bad-cost',
      agent: 'invalid-cost',
      usageKind: 'tokens',
      totalTokens: 3,
      costUsdMicros: Number.MAX_SAFE_INTEGER + 1,
      occurredAt: T0 + 200,
    })

    expect(listRunCostsSince(T0).find((row) => row.runId === 'turn:bad-cost')).toMatchObject({
      totalTokens: 3,
      costUsdMicros: null,
    })
    expect(runTokensByAgentSince(T0).find((row) => row.agent === 'invalid-cost')).toMatchObject({
      tokenMeteredRuns: 1,
      costedRuns: 0,
    })
  })
})

describe('completionsByAgentSince', () => {
  it('counts completions per agent within the window', () => {
    recordCompletion('c1', { agent: 'pixel', now: T0 + 1000 })
    recordCompletion('c2', { agent: 'pixel', now: T0 + 2000 })
    recordCompletion('c3', { agent: 'scout', now: T0 + 3000 })
    recordCompletion('c4', { agent: 'pixel', now: T0 - 50_000 }) // outside window

    const rows = completionsByAgentSince(T0)
    const byAgent = Object.fromEntries(rows.map((r) => [r.agent, r.completions]))
    expect(byAgent.pixel).toBe(2)
    expect(byAgent.scout).toBe(1)

    expect(completionsByAgentSince(T0 + 60_000)).toEqual([])
  })
})
