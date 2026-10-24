/**
 * Re-homing table rows 160–171 (spend.budget): the kill switch is a
 * one-click resume (spends money); the invalid policy file, open incidents
 * and a reached cap are the operator's decisions on the Spend page; an
 * unreachable ledger goes to the fallback lane; the pricing refresh
 * self-heals and the fossil write-off is one-click; 162/164/166/170/171 are
 * observations. Emission beyond the kill switch rides health-checks.test.ts
 * (it needs the ledger + usage mocks).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
let policyRegistered = true
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    has: (name: string) => name !== 'spend.getBudgetPolicy' || policyRegistered,
    invoke: async (name: string) => (name === 'spend.getBudgetPolicy' ? { rules: [] } : undefined),
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../../src/core/plugin-registry', hookRegistryMock)

import { SPEND_BUDGET_INCIDENTS, acceptUnattributedHistoryRepair, budgetResumeRepair, capReachedResolution, checkBudget, incidentDecisionChoices, spendEvidenceRepair } from '@bakin/spend/lib/health-checks'
import { resetSettingsCache } from '../../../src/core/settings'
import { closeAllDbs } from '../../../packages/core/src/storage/db'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { stampPlanItems } from '../../helpers/repair-contract'

const family = (id: string) => SPEND_BUDGET_INCIDENTS.find((d) => d.id === id)
async function rows() {
  const parsed = parseHealthCheckRunInput(await checkBudget())
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}
afterAll(() => { closeAllDbs(); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => { closeAllDbs(); rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); policyRegistered = true; resetSettingsCache() })

describe('spend re-homing — catalog', () => {
  it('rows 160–169 declare their families; 162/164/166/170/171 are not families', () => {
    expect(family('dispatch-paused')).toMatchObject({ subjectKind: 'system', resolution: { type: 'repair', actionId: 'budget-resume' }, required: 'always' })
    expect(family('policy-invalid')).toMatchObject({ subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'always' })
    expect(family('open-incidents')).toMatchObject({ subjectKind: 'system', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' })
    expect(family('spend-ledger-unavailable')).toMatchObject({ subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' })
    expect(family('cap-reached')).toMatchObject({ subjectKind: 'setting', resolution: { type: 'human', needs: 'decision' }, required: 'always' })
    expect(family('spend-evidence-pricing')).toMatchObject({ subjectKind: 'system', resolution: { type: 'repair', actionId: 'spend-evidence-refresh-pricing' }, required: 'never' })
    expect(family('spend-evidence-unattributed')).toMatchObject({ subjectKind: 'setting', resolution: { type: 'repair', actionId: 'accept-unattributed-history' }, required: 'never' })
    expect(SPEND_BUDGET_INCIDENTS).toHaveLength(7)
  })
  it('rows 163/167 card buttons: raise is a link to the control, ack/resume are requests through the resolve route (resume confirmed; no ack once acknowledged)', () => {
    const open = incidentDecisionChoices({ id: 7, scope: 'agent', scopeId: 'pixel', lane: 'metered', window: 'daily', status: 'open' })
    expect(open.map((c) => [c.key, c.kind])).toEqual([['raise', 'link'], ['ack', 'request'], ['resume', 'request']])
    expect(open[0]).toMatchObject({ href: '/spend?incident=7' })
    expect(open[2]).toMatchObject({ method: 'POST', url: '/api/plugins/spend/incidents/7/resolve', body: { action: 'resume' }, confirm: { title: 'Resume dispatch for agent pixel?' } })
    expect(incidentDecisionChoices({ id: 7, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', status: 'acknowledged' }).map((c) => c.key)).toEqual(['raise', 'resume'])
    const cap = capReachedResolution({ id: 'r9', scope: 'global', lane: 'metered', dailyCap: 10 }, [])
    expect(cap).toMatchObject({ type: 'human', needs: 'decision', href: '/spend?tab=limits&field=r9', field: 'budget-rule-r9', choices: [{ key: 'raise', kind: 'link', href: '/spend?tab=limits&field=r9', field: 'budget-rule-r9' }] })
    const capWithIncident = capReachedResolution({ id: 'r9', scope: 'global', lane: 'metered', dailyCap: 10 }, [{ id: 3, scope: 'global', scopeId: '', lane: 'metered', status: 'open' } as never])
    expect(capWithIncident.choices?.[1]).toMatchObject({ key: 'ack', kind: 'request', url: '/api/plugins/spend/incidents/3/resolve', body: { action: 'ack' } })
  })
  it('action effects: resume spends money (one-click, policy); pricing refresh self-heals; the write-off widens authorization (one-click, policy)', () => {
    expect(budgetResumeRepair().effects).toEqual({ deletesUserContent: false, spendsMoney: true, widensAuthorization: false })
    expect(budgetResumeRepair().mutation).toBe('policy')
    expect(spendEvidenceRepair().effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    expect(acceptUnattributedHistoryRepair().effects.widensAuthorization).toBe(true)
    expect(acceptUnattributedHistoryRepair().mutation).toBe('policy')
  })
})

describe('spend re-homing — emitted instances', () => {
  it('row 160: the kill switch is a required repair incident; its plan item is one-click', async () => {
    writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ dispatch: { paused: true } }))
    resetSettingsCache()
    const paused = (await rows()).find((r) => r.key === 'dispatch-paused')!
    expect(paused.incident).toMatchObject({ declarationId: 'dispatch-paused', subject: { kind: 'system', id: 'dispatch' }, resolution: { type: 'repair', actionId: 'budget-resume' } })
    const action = budgetResumeRepair()
    expect(stampPlanItems(action, await action.plan({ type: 'all_actionable', reportId: 'r' }))[0]!.mode).toBe('one-click')
  })
  it('row 162: an unregistered policy hook is an unknown observation, never a card', async () => {
    policyRegistered = false
    const [row] = await rows()
    expect(row!.status).toBe('unknown')
    expect(row!.incident).toBeUndefined()
  })
})
