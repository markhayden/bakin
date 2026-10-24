/**
 * `core.diagnose` (self-healing 1.5): the shared engine action whose apply
 * is the fallback lane — one investigation task through the ONE delegate,
 * taking over the running repair's incident reservation, every delegate
 * outcome mapped to an honest result. The item is `manual` (A17: ask).
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-doctor-diagnose-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), tasks: join(testDir, 'tasks'), logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import type { HealthIncident, HealthReport } from '@makinbakin/sdk'
import { SHARED_ENGINE_ACTIONS } from '../../packages/core/src/health/authorize-mutation'
import { DIAGNOSE_ACTION_ID, FALLBACK_TURN_BUDGET, diagnoseRepair, type DiagnoseRepairDeps } from '../../src/core/doctor-diagnose-repair'
import type { DoctorDelegateOptions, DoctorDelegateReport } from '../../src/core/doctor-delegate'
import { reserveIncidents, resetIncidentReservationsForTests } from '../../src/core/doctor-reservations'
import { noopOp } from '../helpers/operation-harness'
import { stampPlanItems } from '../helpers/repair-contract'

afterEach(() => resetIncidentReservationsForTests())

const incident: HealthIncident = {
  id: 'health:ledger:unavailable',
  status: 'error',
  disposition: 'action_required',
  effectiveDisposition: 'action_required',
  title: 'Execution ledger is unavailable',
  impact: 'Nothing fires exactly once.',
  subject: { kind: 'system', id: 'execution-ledger' },
  declarationId: 'ledger-unavailable',
  required: true,
  resources: [],
  resolution: { key: 'diagnose', type: 'repair', label: 'Investigate', actionId: DIAGNOSE_ACTION_ID },
  observationIds: ['health.execution-safety:ledger'],
  observedAt: '2026-10-24T00:00:00.000Z',
  staleAt: '2026-10-24T01:00:00.000Z',
  stale: false,
}

const report = {
  id: 'report-1',
  incidents: [incident],
  observations: [{ id: 'health.execution-safety:ledger', checkId: 'health.execution-safety' }],
} as unknown as HealthReport

const request = (over: Record<string, unknown> = {}) => ({ id: 'req-1', taskId: 'task-9', agentId: 'main', ...over }) as unknown as DoctorDelegateReport extends { request: infer R } ? R : never

function deps(outcome: DoctorDelegateReport, calls: DoctorDelegateOptions[] = []): DiagnoseRepairDeps {
  return {
    delegate: async (options) => { calls.push(options); return outcome },
    roots: () => ({ contentDir: testDir, projectRoot: '/repo' }),
    report: () => report,
    fallback: () => ({ attempts: [], turnBudget: { total: FALLBACK_TURN_BUDGET, remaining: FALLBACK_TURN_BUDGET }, proposableActions: ['health.x'], terminalAvailable: false, tools: { handback: false, repair: false } }),
  }
}

const item = { id: 'core.diagnose:investigate', actionId: 'diagnose', title: 'Investigate', reason: 'r', effects: { deletesUserContent: false, spendsMoney: true, widensAuthorization: false }, mode: 'one-click' as const, incidentIds: [incident.id], observationIds: [], preconditions: [], changes: [] }

describe('core.diagnose', () => {
  it('is the shared engine action and plans one one-click investigation item for the target (A17: investigations ask)', async () => {
    expect(SHARED_ENGINE_ACTIONS).toContain(DIAGNOSE_ACTION_ID)
    const action = diagnoseRepair(deps({ status: 'sent', request: request(), incidents: [incident] }))
    // Spec §3.1: the action's own effects are all false; the ITEM spends agent turns, so it is one-click.
    expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    const items = stampPlanItems(action, await action.plan({ type: 'incidents', reportId: 'report-1', ids: [incident.id] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ actionId: 'diagnose', mode: 'one-click', effects: { spendsMoney: true }, incidentIds: [incident.id], changes: [{ kind: 'task', action: 'create' }] })
    expect(action.operationPlan(items).pointOfNoReturn).toBe('delegate')
  })

  it('apply opens the investigation task through the delegate with the fallback brief, taking over the running repair\'s reservation', async () => {
    const calls: DoctorDelegateOptions[] = []
    reserveIncidents([incident.id], 'repair:fingerprint-1')
    const action = diagnoseRepair(deps({ status: 'sent', request: request(), incidents: [incident] }, calls))
    const results = await action.apply([item], noopOp())
    expect(results).toEqual([expect.objectContaining({ status: 'applied', affectedCheckIds: ['health.execution-safety'] })])
    expect(results[0]!.message).toContain('Opened investigation task task-9 for main')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ contentDir: testDir, projectRoot: '/repo', accepted: true, reservation: 'repair:fingerprint-1', target: { type: 'incidents', reportId: 'report-1', ids: [incident.id] } })
    expect(calls[0]!.fallback).toMatchObject({ turnBudget: { total: 3, remaining: 3 }, proposableActions: ['health.x'] })
  })

  it('without a holder the delegate reserves afresh (no reservation passed)', async () => {
    const calls: DoctorDelegateOptions[] = []
    await diagnoseRepair(deps({ status: 'sent', request: request(), incidents: [incident] }, calls)).apply([item], noopOp())
    expect(calls[0]!.reservation).toBeUndefined()
  })

  it('maps every delegate outcome honestly', async () => {
    const run = async (outcome: DoctorDelegateReport) => (await diagnoseRepair(deps(outcome)).apply([item], noopOp()))[0]!
    expect(await run({ status: 'already_delegated', request: request(), incidents: [incident] })).toMatchObject({ status: 'skipped', message: expect.stringContaining('task-9 is already investigating') })
    expect(await run({ status: 'no_unresolved', request: request(), incidents: [] })).toMatchObject({ status: 'skipped', message: expect.stringContaining('no longer open') })
    expect(await run({ status: 'confirmation_required', request: request(), incidents: [incident] })).toMatchObject({ status: 'failed' })
    expect(await run({ status: 'repair_in_flight', incidents: [incident], overlapping: [incident.id], heldBy: 'repair:other' })).toMatchObject({ status: 'failed', message: expect.stringContaining('repair:other') })
  })

  it('an item without incidents is skipped, never delegated', async () => {
    const calls: DoctorDelegateOptions[] = []
    const results = await diagnoseRepair(deps({ status: 'sent', request: request(), incidents: [] }, calls)).apply([{ ...item, incidentIds: [] }], noopOp())
    expect(results[0]).toMatchObject({ status: 'skipped' })
    expect(calls).toHaveLength(0)
  })
})
