/**
 * Task liveness — the ledger is the ONLY liveness authority (spec D3).
 * A task is stranded when it is in progress and the ledger holds no running
 * run for it; heartbeat files never gate this. Run-heartbeat bumps carry
 * execution identity (plan review R6).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-liveness-${Date.now()}-${randomUUID()}`)

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
  loseRun,
  markPriorBootRunsLost,
  getLiveRun,
  getLiveRunByKey,
} from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'
import {
  isStrandedInProgress,
  stepExecKey,
  assessWorkflowRuns,
  bumpRunHeartbeat,
  bumpTaskRunHeartbeat,
  collectWorkflowDescendantTaskIds,
} from '../../src/core/task-liveness'

const BOOT = 'boot-liveness-1'

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

describe('isStrandedInProgress', () => {
  it('a task outside inProgress is never stranded, even with no run', () => {
    expect(isStrandedInProgress({ id: 'todo-1', column: 'todo' })).toBe(false)
    expect(isStrandedInProgress({ id: 'blocked-1', column: 'blocked' })).toBe(false)
  })

  it('in progress with no running row is stranded', () => {
    expect(isStrandedInProgress({ id: 'strand-1', column: 'inProgress' })).toBe(true)
  })

  it('in progress with a live run is not stranded', () => {
    expect(claim('live-1', 1)).toEqual({ claimed: true })
    expect(isStrandedInProgress({ id: 'live-1', column: 'inProgress' })).toBe(false)
  })

  it('becomes stranded again after settle, loss, or the boot sweep', () => {
    expect(claim('settle-1', 1)).toEqual({ claimed: true })
    settleRun('task:settle-1:d1', 'ok')
    expect(isStrandedInProgress({ id: 'settle-1', column: 'inProgress' })).toBe(true)

    expect(claim('lose-1', 1)).toEqual({ claimed: true })
    loseRun('task:lose-1:d1', 'session-death')
    expect(isStrandedInProgress({ id: 'lose-1', column: 'inProgress' })).toBe(true)

    expect(claim('sweep-1', 1, { bootId: 'boot-old' })).toEqual({ claimed: true })
    markPriorBootRunsLost(BOOT)
    expect(isStrandedInProgress({ id: 'sweep-1', column: 'inProgress' })).toBe(true)
  })
})

describe('stepExecKey + assessWorkflowRuns', () => {
  it('keys a step by task and step id — the one home for the format', () => {
    expect(stepExecKey('t1', 'draft')).toBe('t1:draft')
  })

  it('reports expected vs live step runs, keyed by the effective (child) task id', () => {
    const parent = 'wf-parent'
    expect(claimRun({
      runId: `task:${parent}:step:draft:d1`,
      taskId: parent,
      execKey: stepExecKey(parent, 'draft'),
      seq: 1,
      agent: 'ada',
      bootId: BOOT,
    })).toEqual({ claimed: true })
    // Nested child step claims on the CHILD task id (dispatch-workflow keys by contextTaskId).
    expect(claimRun({
      runId: 'task:wf-child:step:review:d1',
      taskId: 'wf-child',
      execKey: stepExecKey('wf-child', 'review'),
      seq: 1,
      agent: 'bo',
      bootId: BOOT,
    })).toEqual({ claimed: true })

    const result = assessWorkflowRuns(parent, [
      { agent: 'ada', stepId: 'draft' },
      { agent: 'bo', stepId: 'review', effectiveTaskId: 'wf-child' },
      { agent: 'cy', stepId: 'publish' },
    ])
    expect(result.expected).toEqual(['wf-parent:draft', 'wf-child:review', 'wf-parent:publish'])
    expect(result.live).toEqual(['wf-parent:draft', 'wf-child:review'])
    expect(result.missing).toEqual(['wf-parent:publish'])
  })

  it('no active agents means nothing expected, nothing live, stranded', () => {
    expect(assessWorkflowRuns('wf-empty', [])).toEqual({ expected: [], live: [], missing: [], otherLive: [], stranded: true })
  })

  it('a running row outside the expected steps counts as other live execution (review P1)', () => {
    const task = 'wf-transition'
    expect(claimRun({ runId: `task:${task}:step:previous:d1`, taskId: task, execKey: stepExecKey(task, 'previous'), seq: 1, agent: 'pixel', bootId: BOOT })).toEqual({ claimed: true })

    const result = assessWorkflowRuns(task, [{ agent: 'patch', stepId: 'next' }])
    expect(result.live).toEqual([])
    expect(result.missing).toEqual(['wf-transition:next'])
    expect(result.otherLive.map((r) => r.execKey)).toEqual(['wf-transition:previous'])
    expect(result.stranded).toBe(false)
  })

  it('a completed nested child whose final turn is still running counts as other live execution (review round 2)', () => {
    expect(claimRun({ runId: 'task:inner-done:step:final:d1', taskId: 'inner-done', execKey: stepExecKey('inner-done', 'final'), seq: 1, agent: 'pixel', bootId: BOOT })).toEqual({ claimed: true })

    const withoutDescendants = assessWorkflowRuns('outer-done', [{ agent: 'patch', stepId: 'next' }])
    expect(withoutDescendants.stranded).toBe(true)

    const withDescendants = assessWorkflowRuns('outer-done', [{ agent: 'patch', stepId: 'next' }], ['inner-done'])
    expect(withDescendants.otherLive.map((r) => r.taskId)).toEqual(['inner-done'])
    expect(withDescendants.stranded).toBe(false)
  })

  it('expected steps live and nothing else: not stranded, no other rows', () => {
    const task = 'wf-steady'
    expect(claimRun({ runId: `task:${task}:step:a:d1`, taskId: task, execKey: stepExecKey(task, 'a'), seq: 1, agent: 'ada', bootId: BOOT })).toEqual({ claimed: true })
    const result = assessWorkflowRuns(task, [{ agent: 'ada', stepId: 'a' }])
    expect(result).toMatchObject({ live: ['wf-steady:a'], missing: [], otherLive: [], stranded: false })
  })
})

describe('collectWorkflowDescendantTaskIds', () => {
  it('walks nested children and map children of every step status, recursively, with a cycle guard', async () => {
    const instances: Record<string, { stepStates: Record<string, { childTaskId?: string; children?: Array<{ childTaskId: string }> }> }> = {
      outer: { stepStates: {
        nested: { childTaskId: 'child-a' },                 // completed nested step
        fan: { children: [{ childTaskId: 'm-1' }, { childTaskId: 'm-2' }] }, // joined map step
        next: {},
      } },
      'child-a': { stepStates: { deeper: { childTaskId: 'grandchild' } } },
      grandchild: { stepStates: { loop: { childTaskId: 'outer' } } }, // cycle back to the root
      'm-1': { stepStates: {} },
    }
    const ids = await collectWorkflowDescendantTaskIds('outer', async (id) => instances[id] ?? null)
    expect(ids).toEqual(['child-a', 'm-1', 'm-2', 'grandchild'])
  })

  it('an unknown instance yields no descendants', async () => {
    expect(await collectWorkflowDescendantTaskIds('nope', async () => null)).toEqual([])
  })
})

describe('bumpRunHeartbeat (exact run id)', () => {
  it('advances heartbeat_at of the named running row only', () => {
    const t0 = 5_000_000
    expect(claim('hb-run', 1, { now: t0 })).toEqual({ claimed: true })
    bumpRunHeartbeat('task:hb-run:d1', t0 + 1_000)
    expect(getLiveRun('hb-run')?.heartbeatAt).toBe(t0 + 1_000)
  })

  it('never throws when the run is unknown', () => {
    expect(() => bumpRunHeartbeat('task:nope:d9')).not.toThrow()
  })
})

describe('bumpTaskRunHeartbeat (task + agent, exactly-one-row rule)', () => {
  it('bumps when exactly one running row matches the task and agent', () => {
    const t0 = 6_000_000
    expect(claim('hb-one', 1, { agent: 'ada', now: t0 })).toEqual({ claimed: true })
    expect(bumpTaskRunHeartbeat('hb-one', 'ada', t0 + 500)).toBe(true)
    expect(getLiveRun('hb-one')?.heartbeatAt).toBe(t0 + 500)
  })

  it('bumps nothing when the agent does not own the live run', () => {
    const t0 = 7_000_000
    expect(claim('hb-other', 1, { agent: 'ada', now: t0 })).toEqual({ claimed: true })
    expect(bumpTaskRunHeartbeat('hb-other', 'bo', t0 + 500)).toBe(false)
    expect(getLiveRun('hb-other')?.heartbeatAt).toBe(t0)
  })

  it('bumps nothing when the task has no live run', () => {
    expect(bumpTaskRunHeartbeat('hb-none', 'ada')).toBe(false)
  })

  it('two concurrent steps, only one producing activity: only its row advances', () => {
    const t0 = 8_000_000
    const task = 'hb-steps'
    expect(claimRun({ runId: `task:${task}:step:a:d1`, taskId: task, execKey: stepExecKey(task, 'a'), seq: 1, agent: 'ada', bootId: BOOT, now: t0 })).toEqual({ claimed: true })
    expect(claimRun({ runId: `task:${task}:step:b:d1`, taskId: task, execKey: stepExecKey(task, 'b'), seq: 2, agent: 'bo', bootId: BOOT, now: t0 })).toEqual({ claimed: true })

    expect(bumpTaskRunHeartbeat(task, 'ada', t0 + 900)).toBe(true)
    expect(getLiveRunByKey(stepExecKey(task, 'a'))?.heartbeatAt).toBe(t0 + 900)
    expect(getLiveRunByKey(stepExecKey(task, 'b'))?.heartbeatAt).toBe(t0)
  })

  it('same-agent parallel steps on one task are ambiguous — nothing is bumped', () => {
    const t0 = 9_000_000
    const task = 'hb-ambiguous'
    expect(claimRun({ runId: `task:${task}:step:a:d1`, taskId: task, execKey: stepExecKey(task, 'a'), seq: 1, agent: 'ada', bootId: BOOT, now: t0 })).toEqual({ claimed: true })
    expect(claimRun({ runId: `task:${task}:step:b:d1`, taskId: task, execKey: stepExecKey(task, 'b'), seq: 2, agent: 'ada', bootId: BOOT, now: t0 })).toEqual({ claimed: true })

    expect(bumpTaskRunHeartbeat(task, 'ada', t0 + 900)).toBe(false)
    expect(getLiveRunByKey(stepExecKey(task, 'a'))?.heartbeatAt).toBe(t0)
    expect(getLiveRunByKey(stepExecKey(task, 'b'))?.heartbeatAt).toBe(t0)
  })

  it('swallows ledger failures (advisory signal, never breaks the caller)', () => {
    expect(bumpTaskRunHeartbeat(undefined, 'ada')).toBe(false)
  })
})
