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
  claimNextRun,
  settleRun,
  loseRun,
  supersedeStaleRun,
  markPriorBootRunsLost,
  bumpHeartbeat,
  bumpHeartbeatByTask,
  getLiveRun,
  getLiveRunByKey,
  listRunsByTask,
  nextSeq,
  currentSeq,
  setSeqWatermark,
  claimCronFire,
  getCronFire,
  attachCronTask,
  markCronFireSkipped,
  findHealableCronClaims,
  listCronFires,
  recordCompletion,
  hasCompletion,
  getCompletion,
  deleteCompletion,
  getIdempotent,
  putIdempotent,
  purgeTaskRows,
  recordRunCost,
  listRunCostsSince,
  openBudgetIncident,
  resolveBudgetIncident,
  listBudgetIncidents,
  resolveExpiredBudgetIncidents,
  findOpenCapIncident,
  recentRunsByAgent,
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
    expect(win).toEqual({ superseded: true, runIds: ['task:t4:d1'] })
    expect(supersedeStaleRun('t4', t0 + 1)).toEqual({ superseded: false })
    expect(getLiveRun('t4')).toBeNull()
  })

  it('heartbeat bumps protect a live run from supersede', () => {
    const t0 = 2_000_000
    expect(claim('t5', 1, { now: t0 })).toEqual({ claimed: true })
    bumpHeartbeatByTask('t5', t0 + 500)
    expect(supersedeStaleRun('t5', t0 + 100)).toEqual({ superseded: false })
    bumpHeartbeat('task:t5:d1', t0 + 900)
    expect(supersedeStaleRun('t5', t0 + 901)).toEqual({ superseded: true, runIds: ['task:t5:d1'] })
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

  it('claimNextRun atomically mints and claims; duplicate suppressed; seq advances after settle', () => {
    const mint = () =>
      claimNextRun({ taskId: 't9', agent: 'tester', bootId: BOOT, runIdFor: (seq) => `task:t9:d${seq}` })

    const first = mint()
    expect(first).toEqual({ claimed: true, runId: 'task:t9:d1', seq: 1 })

    const dup = mint()
    expect(dup.claimed).toBe(false)
    if (!dup.claimed) expect(dup.liveRunId).toBe('task:t9:d1')

    expect(settleRun('task:t9:d1', 'ok')).toBe(true)
    expect(mint()).toEqual({ claimed: true, runId: 'task:t9:d2', seq: 2 })
    settleRun('task:t9:d2', 'ok')
  })

  it('workflow steps run in parallel: live-run lock scopes to execKey, not task', () => {
    const step = (stepId: string) =>
      claimNextRun({
        taskId: 'wf1',
        execKey: `wf1:${stepId}`,
        agent: 'tester',
        bootId: BOOT,
        runIdFor: (seq) => `task:wf1:step:${stepId}:d${seq}`,
      })

    const s1 = step('research')
    const s2 = step('draft')
    expect(s1.claimed).toBe(true)
    expect(s2.claimed).toBe(true)
    // Shared per-task seq counter (legacy threadId semantics preserved)
    if (s1.claimed && s2.claimed) {
      expect([s1.seq, s2.seq].sort()).toEqual([1, 2])
    }

    // Same step claimed again → suppressed
    expect(step('research').claimed).toBe(false)
    expect(getLiveRunByKey('wf1:research')?.agent).toBe('tester')
    if (s1.claimed) settleRun(s1.runId, 'ok')
    if (s2.claimed) settleRun(s2.runId, 'ok')
  })

  it('currentSeq reports the highest used seq', () => {
    expect(currentSeq('fresh-task')).toBe(0)
    setSeqWatermark('fresh-task', 7)
    expect(currentSeq('fresh-task')).toBe(7)
  })
})

describe('listRunsByTask — per-task attempt history, newest first', () => {
  it('returns every run for a task newest-first with status + settle reason, bounded by limit', () => {
    const base = 5_000_000
    claim('rh', 1, { now: base })
    loseRun('task:rh:d1', 'session-death', base + 10)
    claim('rh', 2, { now: base + 1_000 })
    settleRun('task:rh:d2', 'turn-ok', base + 1_010)
    claim('rh', 3, { now: base + 2_000 }) // left running (live)
    claim('other', 1, { now: base + 3_000 }) // different task — must be excluded

    const runs = listRunsByTask('rh', 50)
    expect(runs.map((r) => r.seq)).toEqual([3, 2, 1]) // newest started_at first
    expect(runs.map((r) => r.status)).toEqual(['running', 'settled', 'lost'])
    expect(runs.find((r) => r.seq === 2)?.settleReason).toBe('turn-ok')
    expect(runs.find((r) => r.seq === 1)?.settleReason).toBe('session-death')
    expect(runs.every((r) => r.agent === 'tester')).toBe(true)

    expect(listRunsByTask('rh', 2).map((r) => r.seq)).toEqual([3, 2]) // limit honored
    expect(listRunsByTask('no-such-task', 50)).toEqual([])

    settleRun('task:rh:d3', 'ok') // free the live slot for any later test on this task
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

  it('records the skip reason and round-trips it on read', () => {
    claimCronFire('job-skip', 'run-overlap', Date.now())
    markCronFireSkipped('job-skip', 'run-overlap', 'overlap')
    expect(getCronFire('job-skip', 'run-overlap')?.skipReason).toBe('overlap')
    // a reason-less skip leaves the column null (back-compat with bare callers)
    claimCronFire('job-skip', 'run-bare', Date.now())
    markCronFireSkipped('job-skip', 'run-bare')
    expect(getCronFire('job-skip', 'run-bare')?.skipReason).toBeNull()
  })
})

describe('listCronFires — per-job history, newest first', () => {
  it('returns a job\'s fires newest-first with disposition + reason, bounded by limit', () => {
    const base = Date.now()
    claimCronFire('hist', 'r1', base - 30_000)
    attachCronTask('hist', 'r1', 'task-1')
    claimCronFire('hist', 'r2', base - 20_000)
    markCronFireSkipped('hist', 'r2', 'paused')
    claimCronFire('hist', 'r3', base - 10_000) // stays pending
    claimCronFire('other', 'x1', base - 5_000) // different job — excluded

    const all = listCronFires('hist', 50)
    expect(all.map((f) => f.runId)).toEqual(['r3', 'r2', 'r1']) // newest fired_at first
    expect(all.find((f) => f.runId === 'r1')?.disposition).toBe('created')
    expect(all.find((f) => f.runId === 'r1')?.taskId).toBe('task-1')
    expect(all.find((f) => f.runId === 'r2')?.skipReason).toBe('paused')

    expect(listCronFires('hist', 2).map((f) => f.runId)).toEqual(['r3', 'r2']) // limit honored
    expect(listCronFires('nope', 50)).toEqual([])
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

describe('run costs', () => {
  const T0 = 1_700_000_000_000 // fixed base ms for deterministic windows

  it('records cost rows and lists them for the spend engine (agent/model/cost intact)', () => {
    recordRunCost({ workClass: null, runId: 'task:rc1:d1', taskId: 'rc1', agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costUsdMicros: 6000, occurredAt: T0 })
    recordRunCost({ workClass: null, runId: 'task:rc2:d1', taskId: 'rc2', agent: 'rolo', model: 'openai/gpt-5.4', inputTokens: 500, outputTokens: 100, totalTokens: 600, costUsdMicros: 4500, occurredAt: T0 + 1000 })

    const rows = listRunCostsSince(T0 - 1)
    expect(rows.find((r) => r.runId === 'task:rc1:d1')).toMatchObject({ agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 6000 })
    expect(rows.find((r) => r.runId === 'task:rc2:d1')).toMatchObject({ agent: 'rolo', model: 'openai/gpt-5.4', costUsdMicros: 4500 })
  })

  it('is idempotent on run_id — a retry of the same run does not double-count', () => {
    recordRunCost({ workClass: null, runId: 'task:rc-dup:d1', taskId: 'rc-dup', agent: 'pixel', model: 'm', inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsdMicros: 100, occurredAt: T0 })
    recordRunCost({ workClass: null, runId: 'task:rc-dup:d1', taskId: 'rc-dup', agent: 'pixel', model: 'm', inputTokens: 999, outputTokens: 999, totalTokens: 1998, costUsdMicros: 9999, occurredAt: T0 })
    const dup = listRunCostsSince(T0 - 1).find((r) => r.runId === 'task:rc-dup:d1')
    expect(dup).toMatchObject({ costUsdMicros: 100 }) // first write wins; the dup write is ignored
  })

  it('filters the listing window by sinceMs', () => {
    recordRunCost({ workClass: null, runId: 'task:rc-old:d1', taskId: 'rc-old', agent: 'pixel', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsdMicros: 5000, occurredAt: T0 - 100_000 })
    expect(listRunCostsSince(T0 - 1).some((r) => r.runId === 'task:rc-old:d1')).toBe(false) // excludes the old row
    expect(listRunCostsSince(T0 - 200_000).some((r) => r.runId === 'task:rc-old:d1')).toBe(true) // includes it
  })

  it('records a non-dispatch row with no task_id and lists it for the spend engine', () => {
    recordRunCost({ workClass: null, runId: 'turn:nondispatch-1', agent: 'main', model: 'm', inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsdMicros: 7000, occurredAt: T0 + 9000 })
    const main = listRunCostsSince(T0 - 1).find((r) => r.runId === 'turn:nondispatch-1')
    expect(main).toMatchObject({ agent: 'main', costUsdMicros: 7000 })
  })

  it('keeps a null-cost (unmetered) row honestly null — never a fabricated zero', () => {
    recordRunCost({ workClass: null, runId: 'task:rc-unm:d1', taskId: 'rc-unm', agent: 'patch', model: 'mystery/x', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsdMicros: null, occurredAt: T0 + 5000 })
    const patch = listRunCostsSince(T0 - 1).find((r) => r.runId === 'task:rc-unm:d1')
    expect(patch).toMatchObject({ agent: 'patch', costUsdMicros: null })
  })

  it('persists provider and lane and lists raw rows for the spend engine', () => {
    recordRunCost({ workClass: null, runId: 'task:rc-lane1:d1', taskId: 'rc-lane1', agent: 'lane-a', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsdMicros: 300, occurredAt: T0 + 50_000 })
    recordRunCost({ workClass: null, runId: 'task:rc-lane2:d1', taskId: 'rc-lane2', agent: 'lane-a', model: 'openai-codex/gpt-5.5-codex', provider: 'openai-codex', lane: 'subscription', inputTokens: 900, outputTokens: 80, totalTokens: 980, costUsdMicros: null, occurredAt: T0 + 51_000 })

    const rows = listRunCostsSince(T0 + 49_000).filter((r) => r.agent === 'lane-a')
    expect(rows).toHaveLength(2)
    const byRun = new Map(rows.map((r) => [r.runId, r]))
    expect(byRun.get('task:rc-lane1:d1')).toMatchObject({
      agent: 'lane-a', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered',
      totalTokens: 120, costUsdMicros: 300, occurredAt: T0 + 50_000,
    })
    expect(byRun.get('task:rc-lane2:d1')).toMatchObject({
      provider: 'openai-codex', lane: 'subscription', totalTokens: 980, costUsdMicros: null,
    })
  })

  it('listRunCostsSince returns rows without provider/lane as NULLs (never fabricated)', () => {
    recordRunCost({ workClass: null, runId: 'task:rc-nolane:d1', taskId: 'rc-nolane', agent: 'lane-b', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsdMicros: 10, occurredAt: T0 + 52_000 })
    const row = listRunCostsSince(T0 + 51_500).find((r) => r.agent === 'lane-b')
    expect(row).toMatchObject({ provider: null, lane: null })
  })

  it('recentRunsByAgent returns dispatch runs newest-first with token detail', () => {
    recordRunCost({ workClass: null, runId: 'task:rr1:d1', taskId: 'rr1', agent: 'nova', model: 'm', inputTokens: 100, outputTokens: 10, totalTokens: 110, costUsdMicros: 100, occurredAt: T0 })
    recordRunCost({ workClass: null, runId: 'task:rr2:d1', taskId: 'rr2', agent: 'nova', model: 'm', inputTokens: 200, outputTokens: 20, totalTokens: 220, costUsdMicros: 200, occurredAt: T0 + 2000 })
    const rows = recentRunsByAgent('nova')
    expect(rows.map((r) => r.runId)).toEqual(['task:rr2:d1', 'task:rr1:d1'])
    expect(rows[0]).toMatchObject({ taskId: 'rr2', inputTokens: 200, outputTokens: 20, totalTokens: 220, occurredAt: T0 + 2000 })
  })

  it('recentRunsByAgent excludes non-dispatch runs (turn:/image: ids)', () => {
    recordRunCost({ workClass: null, runId: 'turn:rr-watchdog', agent: 'nova', model: 'm', inputTokens: 5000, outputTokens: 1, totalTokens: 5001, costUsdMicros: 1, occurredAt: T0 + 3000 })
    recordRunCost({ workClass: null, runId: 'image:rr-img', agent: 'nova', model: 'img/x', costUsdMicros: 1, occurredAt: T0 + 4000 })
    expect(recentRunsByAgent('nova').every((r) => r.runId.startsWith('task:'))).toBe(true)
  })

  it('persists cache token counts and returns them via recentRunsByAgent', () => {
    recordRunCost({ workClass: null,
      runId: 'task:rr-cache:d1', taskId: 'rr-cache', agent: 'cachet', model: 'm',
      inputTokens: 1000, outputTokens: 50, totalTokens: 1050,
      cacheReadTokens: 900, cacheWriteTokens: 40,
      costUsdMicros: 10, occurredAt: T0,
    })
    // Rows written before the columns existed read back as null, never 0.
    recordRunCost({ workClass: null, runId: 'task:rr-nocache:d1', taskId: 'rr-nocache', agent: 'cachet', model: 'm', inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsdMicros: 1, occurredAt: T0 + 1000 })
    const rows = recentRunsByAgent('cachet')
    expect(rows[1]).toMatchObject({ runId: 'task:rr-cache:d1', cacheReadTokens: 900, cacheWriteTokens: 40 })
    expect(rows[0]).toMatchObject({ runId: 'task:rr-nocache:d1', cacheReadTokens: null, cacheWriteTokens: null })
  })

  it('recentRunsByAgent honors sinceMs and limit', () => {
    expect(recentRunsByAgent('nova', { sinceMs: T0 + 1000 }).map((r) => r.runId)).toEqual(['task:rr2:d1'])
    expect(recentRunsByAgent('nova', { limit: 1 }).map((r) => r.runId)).toEqual(['task:rr2:d1'])
  })
})

describe('budget incidents', () => {
  const W0 = 1_700_000_000_000 // a window start

  it('opens once per (rule identity, window, kind) — the UNIQUE is the debounce', () => {
    const input = {
      scope: 'global' as const, lane: 'metered' as const, window: 'daily' as const,
      windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const,
      capValue: 10_000_000, spentValue: 11_000_000, atCap: 'defer' as const, openedAt: W0 + 1000,
    }
    const first = openBudgetIncident(input)
    expect(first.opened).toBe(true)
    const second = openBudgetIncident({ ...input, spentValue: 12_000_000 })
    expect(second.opened).toBe(false)
    expect(second.id).toBe(first.id)
    expect(listBudgetIncidents({}).filter((i) => i.scope === 'global' && i.windowStartMs === W0)).toHaveLength(1)
  })

  it('distinct rule identities and windows open their own incidents (NULL-free scope key)', () => {
    const base = { lane: 'metered' as const, window: 'daily' as const, windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const, capValue: 1, spentValue: 2, atCap: 'defer' as const, openedAt: W0 }
    expect(openBudgetIncident({ ...base, scope: 'agent', scopeId: 'pixel' }).opened).toBe(true)
    expect(openBudgetIncident({ ...base, scope: 'agent', scopeId: 'rolo' }).opened).toBe(true)
    expect(openBudgetIncident({ ...base, scope: 'agent', scopeId: 'pixel' }).opened).toBe(false) // same identity
    expect(openBudgetIncident({ ...base, scope: 'agent', scopeId: 'pixel', windowStartMs: W0 + 86_400_000 }).opened).toBe(true) // next window
  })

  it('resolve transitions: acknowledged keeps the row live; resolved clears it', () => {
    const input = {
      scope: 'provider' as const, scopeId: 'google', lane: 'metered' as const, window: 'daily' as const,
      windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const,
      capValue: 5_000_000, spentValue: 5_500_000, atCap: 'pause' as const, openedAt: W0,
    }
    const { id } = openBudgetIncident(input)
    expect(resolveBudgetIncident({ id, status: 'acknowledged', resolution: 'acknowledged' })).toBe(true)
    expect(listBudgetIncidents({ openOnly: true }).some((i) => i.id === id)).toBe(true) // acknowledged is still live
    expect(resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })).toBe(true)
    const row = listBudgetIncidents({}).find((i) => i.id === id)
    expect(row?.status).toBe('resolved')
    expect(row?.resolution).toBe('raised')
    expect(listBudgetIncidents({ openOnly: true }).some((i) => i.id === id)).toBe(false)
  })

  it('a breach after a raise-resolution REOPENS the same identity (new event, notifies again)', () => {
    const input = {
      scope: 'agent' as const, scopeId: 'reopen-a', lane: 'metered' as const, window: 'daily' as const,
      windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const,
      capValue: 1_000_000, spentValue: 1_100_000, atCap: 'defer' as const, openedAt: W0,
    }
    const { id } = openBudgetIncident(input)
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })
    const reopened = openBudgetIncident({ ...input, capValue: 2_000_000, spentValue: 2_100_000, openedAt: W0 + 500 })
    expect(reopened.opened).toBe(true)
    expect(reopened.id).toBe(id)
    const row = listBudgetIncidents({ openOnly: true }).find((i) => i.id === id)
    expect(row?.capValue).toBe(2_000_000)
    expect(row?.status).toBe('open')
  })

  it("an 'acknowledged'-resolved incident stays SUPPRESSED on re-breach this window (resume must not re-alert)", () => {
    const input = {
      scope: 'agent' as const, scopeId: 'ack-a', lane: 'metered' as const, window: 'daily' as const,
      windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const,
      capValue: 1_000_000, spentValue: 1_100_000, atCap: 'pause' as const, openedAt: W0,
    }
    const { id } = openBudgetIncident(input)
    // Operator resumes-as-is (dismiss) — spend is still over cap.
    resolveBudgetIncident({ id, status: 'resolved', resolution: 'acknowledged' })
    const rebreached = openBudgetIncident({ ...input, spentValue: 1_200_000, openedAt: W0 + 100 })
    expect(rebreached.opened).toBe(false) // no reopen, no re-notify — the human already dismissed this window
    expect(listBudgetIncidents({ openOnly: true }).some((i) => i.id === id)).toBe(false)
  })

  it('resolveExpiredBudgetIncidents rolls over defer-mode incidents but leaves pause-mode blocking', () => {
    const base = { lane: 'metered' as const, window: 'daily' as const, windowStartMs: W0, kind: 'cap' as const, unit: 'usd_micros' as const, capValue: 1, spentValue: 2, openedAt: W0 }
    const deferInc = openBudgetIncident({ ...base, scope: 'agent', scopeId: 'roll-defer', atCap: 'defer' })
    const pauseInc = openBudgetIncident({ ...base, scope: 'agent', scopeId: 'roll-pause', atCap: 'pause' })
    // Next day: the defer incident's window has ended.
    const resolved = resolveExpiredBudgetIncidents({ dailyWindowStartMs: W0 + 86_400_000, monthlyWindowStartMs: W0, now: W0 + 86_400_000 + 1 })
    expect(resolved).toBeGreaterThanOrEqual(1)
    expect(listBudgetIncidents({ openOnly: true }).some((i) => i.id === deferInc.id)).toBe(false)
    const still = listBudgetIncidents({ openOnly: true }).find((i) => i.id === pauseInc.id)
    expect(still?.status).toBe('open')
    expect(listBudgetIncidents({}).find((i) => i.id === deferInc.id)?.resolution).toBe('window_rollover')
  })

  it('findOpenCapIncident locates the blocking row for pause-mode gating', () => {
    expect(findOpenCapIncident({ scope: 'agent', scopeId: 'roll-pause', lane: 'metered' })?.atCap).toBe('pause')
    expect(findOpenCapIncident({ scope: 'agent', scopeId: 'roll-defer', lane: 'metered' })).toBeNull()
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
