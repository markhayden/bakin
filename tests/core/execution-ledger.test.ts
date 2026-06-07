/**
 * Execution ledger — SQLite coordination facts (claims, cron fires,
 * completions, idempotency). The UNIQUE constraints ARE the locks: a second
 * claim doesn't race a flag, it fails an INSERT.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-ledger-${Date.now()}-${randomUUID()}`)
// Mutable so individual tests can point the db at an unopenable path.
let dbPath = join(testDir, 'bakin.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: dbPath,
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
  loseRun,
  supersedeStaleRun,
  markPriorBootRunsLost,
  bumpHeartbeat,
  bumpHeartbeatByTask,
  getLiveRun,
  nextSeq,
  setSeqWatermark,
  claimCronFire,
  attachCronTask,
  markCronFireSkipped,
  findHealableCronClaims,
  recordCompletion,
  hasCompletion,
  getCompletion,
  deleteCompletion,
  getIdempotent,
  putIdempotent,
  purgeTaskRows,
  LedgerUnavailableError,
} from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const BOOT = 'boot-test-1'

function claim(taskId: string, seq: number, overrides: Partial<Parameters<typeof claimRun>[0]> = {}) {
  return claimRun({
    runId: `task:${taskId}:d${seq}`,
    taskId,
    seq,
    agent: 'tester',
    bootId: BOOT,
    ...overrides,
  })
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('runs — one live run per task', () => {
  it('claims, rejects a second live claim, and frees after settle', () => {
    expect(claim('t1', 1)).toEqual({ claimed: true })

    const second = claim('t1', 2)
    expect(second.claimed).toBe(false)
    if (!second.claimed) expect(second.liveRunId).toBe('task:t1:d1')

    expect(settleRun('task:t1:d1', 'turn-ok')).toBe(true)
    // settle is idempotent-safe: second settle is a no-op
    expect(settleRun('task:t1:d1', 'turn-ok')).toBe(false)

    expect(claim('t1', 2)).toEqual({ claimed: true })
    expect(settleRun('task:t1:d2', 'turn-ok')).toBe(true)
  })

  it('rejects seq reuse even after the live slot is free (UNIQUE task_id+seq)', () => {
    expect(claim('t2', 1)).toEqual({ claimed: true })
    expect(settleRun('task:t2:d1', 'ok')).toBe(true)
    const reuse = claimRun({ runId: 'task:t2:d1-bis', taskId: 't2', seq: 1, agent: 'tester', bootId: BOOT })
    expect(reuse.claimed).toBe(false)
  })

  it('loseRun marks a running row lost', () => {
    expect(claim('t3', 1)).toEqual({ claimed: true })
    expect(loseRun('task:t3:d1', 'session-death')).toBe(true)
    expect(getLiveRun('t3')).toBeNull()
    expect(claim('t3', 2)).toEqual({ claimed: true })
    settleRun('task:t3:d2', 'ok')
  })

  it('supersedeStaleRun supersedes only stale heartbeats, exactly once', () => {
    const t0 = 1_000_000
    expect(claim('t4', 1, { now: t0 })).toEqual({ claimed: true })

    // Fresh heartbeat → no supersede
    expect(supersedeStaleRun('t4', t0 - 1)).toEqual({ superseded: false })

    // Stale → superseded, and the race loser gets zero rows
    const win = supersedeStaleRun('t4', t0 + 1)
    expect(win).toEqual({ superseded: true, runId: 'task:t4:d1' })
    expect(supersedeStaleRun('t4', t0 + 1)).toEqual({ superseded: false })
    expect(getLiveRun('t4')).toBeNull()
  })

  it('heartbeat bumps protect a live run from supersede', () => {
    const t0 = 2_000_000
    expect(claim('t5', 1, { now: t0 })).toEqual({ claimed: true })
    bumpHeartbeatByTask('t5', t0 + 500)
    expect(supersedeStaleRun('t5', t0 + 100)).toEqual({ superseded: false })
    bumpHeartbeat('task:t5:d1', t0 + 900)
    expect(supersedeStaleRun('t5', t0 + 901)).toEqual({ superseded: true, runId: 'task:t5:d1' })
  })

  it('getLiveRun returns the running row', () => {
    expect(claim('t6', 1)).toEqual({ claimed: true })
    const live = getLiveRun('t6')
    expect(live?.runId).toBe('task:t6:d1')
    expect(live?.status).toBe('running')
    expect(live?.bootId).toBe(BOOT)
    settleRun('task:t6:d1', 'ok')
  })

  it('startup sweep marks only prior-boot running rows lost', () => {
    expect(claim('t7', 1, { bootId: 'boot-old' })).toEqual({ claimed: true })
    expect(claim('t8', 1, { bootId: 'boot-new' })).toEqual({ claimed: true })

    expect(markPriorBootRunsLost('boot-new')).toBe(1)
    expect(getLiveRun('t7')).toBeNull()
    expect(getLiveRun('t8')?.runId).toBe('task:t8:d1')
    settleRun('task:t8:d1', 'ok')
  })
})

describe('nextSeq — monotonic per task, watermark-aware', () => {
  it('is monotonic across claims and settles', () => {
    expect(nextSeq('s1')).toBe(1)
    expect(claim('s1', 1)).toEqual({ claimed: true })
    settleRun('task:s1:d1', 'ok')
    expect(nextSeq('s1')).toBe(2)
  })

  it('honors a seeded watermark (no threadId reuse after migration)', () => {
    setSeqWatermark('s2', 5)
    expect(nextSeq('s2')).toBe(6)
    // Watermark uses MAX semantics — a lower re-seed never regresses
    setSeqWatermark('s2', 3)
    expect(nextSeq('s2')).toBe(6)
  })
})

describe('cron_fires — claim before create', () => {
  it('claims a fire exactly once', () => {
    expect(claimCronFire('job1', 'run-a').claimed).toBe(true)
    const dup = claimCronFire('job1', 'run-a')
    expect(dup.claimed).toBe(false)
    if (!dup.claimed) expect(dup.existing?.disposition).toBe('pending')
  })

  it('attach + skip transitions disposition; healer sees only stale pending', () => {
    const now = Date.now()
    claimCronFire('job2', 'run-created', now - 10_000)
    attachCronTask('job2', 'run-created', 'task-xyz')
    claimCronFire('job2', 'run-skipped', now - 10_000)
    markCronFireSkipped('job2', 'run-skipped')
    claimCronFire('job2', 'run-stale-pending', now - 10_000, 'pending', now - 10_000)
    // Old LOGICAL fire time but freshly claimed (reconciler catch-up replay) —
    // must NOT be healable while its create is in flight.
    claimCronFire('job2', 'run-fresh-pending', now - 10_000, 'pending', now)

    const healable = findHealableCronClaims(5_000, now)
    expect(healable.map((c) => c.runId)).toEqual(['run-stale-pending'])
    expect(healable[0].jobId).toBe('job2')
  })

  it('same runId across different jobs is independent', () => {
    expect(claimCronFire('jobA', 'shared-run').claimed).toBe(true)
    expect(claimCronFire('jobB', 'shared-run').claimed).toBe(true)
  })
})

describe('completions — first write wins', () => {
  it('records once; second attempt returns the existing row', () => {
    const first = recordCompletion('c1', { runId: 'task:c1:d1', agent: 'a1', channel: 'mcp' })
    expect(first.recorded).toBe(true)

    const second = recordCompletion('c1', { runId: 'task:c1:d2', agent: 'a2', channel: 'rest' })
    expect(second.recorded).toBe(false)
    if (!second.recorded) {
      expect(second.existing.agent).toBe('a1')
      expect(second.existing.runId).toBe('task:c1:d1')
    }
    expect(hasCompletion('c1')).toBe(true)
    expect(getCompletion('c1')?.channel).toBe('mcp')
  })

  it('reopen (deleteCompletion) allows a fresh first-write', () => {
    recordCompletion('c2', { agent: 'a1' })
    expect(deleteCompletion('c2')).toBe(true)
    expect(deleteCompletion('c2')).toBe(false)
    expect(hasCompletion('c2')).toBe(false)
    expect(recordCompletion('c2', { agent: 'a2' }).recorded).toBe(true)
  })
})

describe('idempotency — durable, first write wins', () => {
  it('round-trips and never overwrites', () => {
    expect(getIdempotent('sig-1')).toBeNull()
    putIdempotent('sig-1', 'image.generate', { assetId: 'a-1', ok: true })
    expect(getIdempotent('sig-1')).toEqual({ kind: 'image.generate', result: { assetId: 'a-1', ok: true } })

    putIdempotent('sig-1', 'image.generate', { assetId: 'a-2', ok: true })
    expect(getIdempotent('sig-1')?.result).toEqual({ assetId: 'a-1', ok: true })
  })
})

describe('purge + durability', () => {
  it('purgeTaskRows removes only the task’s rows', () => {
    claim('p1', 1)
    settleRun('task:p1:d1', 'ok')
    recordCompletion('p1', { agent: 'a' })
    setSeqWatermark('p1', 9)
    claim('p2', 1)
    settleRun('task:p2:d1', 'ok')
    recordCompletion('p2', { agent: 'a' })

    purgeTaskRows('p1')
    expect(hasCompletion('p1')).toBe(false)
    expect(nextSeq('p1')).toBe(1)
    expect(hasCompletion('p2')).toBe(true)
    expect(nextSeq('p2')).toBe(2)
  })

  it('facts survive a close/reopen (restart simulation)', () => {
    recordCompletion('durable-1', { agent: 'a' })
    closeDb()
    expect(hasCompletion('durable-1')).toBe(true)
    expect(getIdempotent('sig-1')?.result).toEqual({ assetId: 'a-1', ok: true })
  })
})

describe('fail-closed', () => {
  it('throws LedgerUnavailableError when the db path is unopenable', () => {
    closeDb()
    const blocked = join(testDir, 'blocked-db')
    mkdirSync(join(blocked, 'bakin.db'), { recursive: true }) // a directory at the db path
    dbPath = join(blocked, 'bakin.db')
    expect(() => hasCompletion('any')).toThrow(LedgerUnavailableError)
    dbPath = join(testDir, 'bakin.db')
    expect(existsSync(dbPath)).toBe(true)
  })
})
