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
