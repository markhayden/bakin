/**
 * Self-healing PR1 slice 1.3d (tasks): `requeue-stranded-tasks` — the
 * restart-recovery engine, one click, for the tasks the stale-tasks incident
 * names (re-homing row 29). Re-running turns is an operator decision (S), so
 * the action is `manual`; exhausted and manual candidates are named, never
 * requeued blind.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-task-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)

type Candidate = { id: string; title: string; agent?: string; effectiveAgents: string[]; missingRuns: string[]; recoveryCount: number; reason: string; action: 'recover' | 'block' | 'manual' }
let candidates: Candidate[] = []
const recovered: string[][] = []
let outcomes: Array<{ id: string; outcome: 'recovered' | 'blocked' | 'skipped'; reason?: string }> = []
mock.module('../../../../src/core/restart-recovery', () => ({
  findRestartRecoveryCandidates: async () => candidates,
  recoverStrandedTasks: async (_dir: string, ids: string[]) => { recovered.push(ids); return outcomes.filter((o) => ids.includes(o.id)) },
}))

import { noopOp } from '../../../helpers/operation-harness'
import { expectRepairContract, runRepairContract, stampPlanItems } from '../../../helpers/repair-contract'
import { parseHealthCheckRunInput } from '../../../../src/core/health-contract'
import { checkRestartRecovery, requeueStrandedTasksRepair } from '../../../../plugins/health/lib/system-checks/restart-recovery'

const cand = (id: string, action: Candidate['action'], reason = 'no-live-run'): Candidate => ({ id, title: `Task ${id}`, agent: 'pixel', effectiveAgents: ['pixel'], missingRuns: [id], recoveryCount: action === 'block' ? 3 : 0, reason, action })
const all = { type: 'all_actionable' as const, reportId: 'r' }

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); candidates = []; recovered.length = 0; outcomes = [] })

describe('requeue-stranded-tasks', () => {
  it('the stale-tasks incident points at the repair and names every stranded task', async () => {
    candidates = [cand('t1', 'recover'), cand('t2', 'manual', 'partial-live-steps')]
    const parsed = parseHealthCheckRunInput(await checkRestartRecovery())
    if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
    expect(parsed.observations[0]!.incident).toMatchObject({ key: 'stale-tasks', resolution: { type: 'repair', actionId: 'requeue-stranded-tasks' } })
    expect(parsed.observations[0]?.incident?.resources?.map((r) => r.id)).toEqual(['t1', 't2'])
  })

  it('plans one manual item per RECOVERABLE task; exhausted and manual candidates are left to the operator (named in the reason)', async () => {
    candidates = [cand('t1', 'recover'), cand('t2', 'block'), cand('t3', 'manual', 'partial-live-steps'), cand('t4', 'recover')]
    const action = requeueStrandedTasksRepair()
    const plan = await action.plan(all)
    expect(plan.map((item) => item.id)).toEqual(['t1', 't4'])
    // Row 29: re-running turns spends money → one-click.
    expect(action.effects).toMatchObject({ spendsMoney: true })
    expect(plan[0]).toMatchObject({ actionId: 'requeue-stranded-tasks' })
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'task', target: 't1', action: 'update' })
    const one = await action.plan({ type: 'incidents', reportId: 'r', ids: ['health.restart-recovery:stale-tasks'] })
    expect(one.map((item) => item.id)).toEqual(['t1', 't4'])
  })

  it('apply requeues through the engine and reports each outcome: recovered → applied, blocked → failed, skipped → skipped with the reason', async () => {
    candidates = [cand('t1', 'recover'), cand('t4', 'recover')]
    outcomes = [{ id: 't1', outcome: 'recovered' }, { id: 't4', outcome: 'skipped', reason: 'gained a live run meanwhile' }]
    const action = requeueStrandedTasksRepair()
    const run = await runRepairContract(action, stampPlanItems(action, await action.plan(all)))
    expectRepairContract(action, run)
    expect(recovered).toEqual([['t1', 't4']])
    expect(run.results.map((r) => [r.itemId, r.status])).toEqual([['t1', 'applied'], ['t4', 'skipped']])
    expect(run.results[1]!.message).toContain('gained a live run')
    expect(run.results[0]).toMatchObject({ affectedCheckIds: ['health.restart-recovery'] })
  })

  it('plans nothing when nothing is recoverable', async () => {
    candidates = [cand('t2', 'block')]
    expect(await requeueStrandedTasksRepair().plan(all)).toEqual([])
    expect(await requeueStrandedTasksRepair().apply([], noopOp())).toEqual([])
  })
})
