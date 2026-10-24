/**
 * Self-healing PR1 slice 1.3d (spend): `budget-resume` — the global kill
 * switch, one click (re-homing row 160). Resuming re-runs turns, so it is
 * `manual`; the incident points at it instead of the `bakin budget resume` text.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    has: () => true,
    invoke: async (name: string) => (name === 'spend.getBudgetPolicy' ? { rules: [] } : undefined),
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../../src/core/plugin-registry', hookRegistryMock)

import { budgetResumeRepair, checkBudget } from '@bakin/spend/lib/health-checks'
import { expectRepairContract, runRepairContract } from '../../helpers/repair-contract'
import { getSettings, resetSettingsCache } from '../../../src/core/settings'
import { closeAllDbs } from '../../../packages/core/src/storage/db'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

const all = { type: 'all_actionable' as const, reportId: 'r' }
async function rows() {
  const parsed = parseHealthCheckRunInput(await checkBudget())
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

afterAll(() => { closeAllDbs(); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ dispatch: { paused: true } }))
  resetSettingsCache()
})

describe('budget-resume', () => {
  it('the paused incident points at the repair; plan is one manual item', async () => {
    const paused = (await rows()).find((r) => r.key === 'dispatch-paused')
    expect(paused?.incident).toMatchObject({ key: 'dispatch-paused', resolution: { type: 'repair', actionId: 'budget-resume' } })
    const action = budgetResumeRepair()
    const plan = await action.plan(all)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ actionId: 'budget-resume', safety: 'manual' })
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'setting', target: 'dispatch.paused' })
  })
  it('apply clears the kill switch in settings.json and the row goes quiet', async () => {
    const action = budgetResumeRepair()
    const run = await runRepairContract(action, await action.plan(all))
    expectRepairContract(action, run)
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['spend.budget'] })
    expect(getSettings().dispatch.paused).toBe(false)
    expect(JSON.parse(readFileSync(join(testDir, 'settings.json'), 'utf-8'))).toMatchObject({ dispatch: { paused: false } })
    expect((await rows()).some((r) => r.key === 'dispatch-paused')).toBe(false)
  })
  it('plans nothing when dispatch is not paused', async () => {
    writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ dispatch: { paused: false } }))
    resetSettingsCache()
    expect(await budgetResumeRepair().plan(all)).toEqual([])
  })
})
