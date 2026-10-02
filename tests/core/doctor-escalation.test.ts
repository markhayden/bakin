/**
 * Health escalation policy (plan PR 2 T8): per-incident cover rules, safe
 * repairs auto-applied, non-safe repairs → ONE review task with a
 * health-repair approval, navigate incidents → one health-navigate approval
 * each, everything else delegated. Planning/apply/approval/delegate are
 * mocked — the policy's decisions are what this file pins.
 */
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { HealthIncident, HealthReport, HealthRepairPlanItem } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-doctor-escalation-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

let mode = true
let cooldownMs = 6 * 60 * 60_000
let staleAfterMs = 12 * 60 * 60_000
let requests: Array<{ id: string; incidentIds: string[]; taskId?: string; createdAt: string }> = []
let taskColumns: Record<string, string> = {}
let planItems: HealthRepairPlanItem[] = []
let planThrows = false
/** Incident ids the (mocked) safe apply leaves burning. */
let afterApplyIncidents: HealthIncident[] | null = null

const delegate = mock(async () => ({ status: 'sent' }))
const openRepairApproval = mock(async (_input: { incidents: HealthIncident[]; items: HealthRepairPlanItem[] }) => ({ taskId: 'task-repair-approval' }))
const openNavigateApproval = mock(async (_input: { incident: HealthIncident }) => ({ taskId: `task-nav-${openNavigateApproval.mock.calls.length}` }))
const applyDoctorRepair = mock(async () => ({ report: report(afterApplyIncidents ?? []), results: [], affectedCheckIds: [], remainingIncidentIds: [], verifiedReportId: 'health-report-2', planId: 'plan-1', basedOnReportId: 'health-report-1' }))
const planDoctorRepair = mock(async () => {
  if (planThrows) throw new Error('action unregistered')
  return { planId: 'plan-1', basedOnReportId: 'health-report-1', target: { type: 'incidents', reportId: 'health-report-1', ids: ['x'] }, createdAt: '', expiresAt: '', items: planItems }
})

mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { escalation: mode, escalationCooldownMs: cooldownMs, escalationStaleAfterMs: staleAfterMs } }),
}))
mock.module('../../src/core/doctor-repair-store', () => ({ listDoctorRepairRequests: () => requests }))
mock.module('../../src/core/task-service', () => ({
  getTaskDetails: async (taskId: string) => taskId in taskColumns ? { column: taskColumns[taskId] } : null,
}))
mock.module('../../src/core/doctor-delegate', () => ({ delegateDoctorRepair: delegate }))
mock.module('../../src/core/doctor-approvals', () => ({ openRepairApproval, openNavigateApproval }))
mock.module('../../src/core/doctor-repair', () => ({ planDoctorRepair, applyDoctorRepair }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

import { coveredIncidentIds, escalateCronIncidents, freshActionRequiredIncidents } from '../../src/core/doctor-escalation'

function incident(overrides: Partial<HealthIncident> = {}): HealthIncident {
  return {
    id: 'health:search:unavailable',
    status: 'error',
    disposition: 'action_required',
    // Effective mirrors raw unless a test overrides it explicitly (#690).
    effectiveDisposition: overrides.disposition ?? 'action_required',
    title: 'Search is unavailable',
    impact: 'Search requests fail.',
    resources: [],
    resolution: { key: 'restart', type: 'instructions', label: 'Restart search', steps: ['bakin install search'] },
    observationIds: ['health.search:engine'],
    observedAt: '2026-07-13T12:00:00.000Z',
    staleAt: '2026-07-13T12:10:00.000Z',
    stale: false,
    ...overrides,
  }
}

const repairIncident = (id = 'health:search:index-corrupt') => incident({ id, title: 'Search index is corrupt', resolution: { key: 'rebuild', type: 'repair', label: 'Rebuild', actionId: 'search.rebuild' }, observationIds: ['health.search:index'] })
const navigateIncident = (id = 'health:runtime:auth-expired') => incident({ id, title: 'Auth expired', resolution: { key: 'login', type: 'navigate', label: 'Renew', href: '/settings?tab=integrations' } })
const item = (overrides: Partial<HealthRepairPlanItem>): HealthRepairPlanItem => ({
  id: 'search.rebuild:rebuild', actionId: 'search.rebuild', title: 'Rebuild', reason: 'Corrupt.', safety: 'destructive',
  incidentIds: ['health:search:index-corrupt'], observationIds: ['health.search:index'], preconditions: [],
  changes: [{ kind: 'file', target: 'index', action: 'delete', description: 'Drop the index.' }],
  ...overrides,
})

function report(incidents: HealthIncident[]): HealthReport {
  return {
    id: 'health-report-1',
    revision: 1,
    generatedAt: '2026-07-13T12:00:00.000Z',
    overallStatus: 'needs_attention',
    sensitivity: 'developer',
    lastFullSweep: null,
    checks: [],
    observations: [],
    incidents,
    subsystems: { search: { status: 'unknown', summary: 'Unknown.', observedAt: null, staleAt: null, stages: [], incidentIds: [] } },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: incidents.length, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
    },
  }
}

function coveringRequest(ageMs: number, overrides: Partial<(typeof requests)[number]> = {}): (typeof requests)[number] {
  return { id: 'repair-1', incidentIds: ['health:search:unavailable'], taskId: 'task-1', createdAt: new Date(Date.now() - ageMs).toISOString(), ...overrides }
}

const escalate = (incidents: HealthIncident[]) => escalateCronIncidents(report(incidents), '/tmp/content', '/tmp/project')

beforeEach(() => {
  mode = true
  cooldownMs = 6 * 60 * 60_000
  staleAfterMs = 12 * 60 * 60_000
  requests = []
  taskColumns = {}
  planItems = []
  planThrows = false
  afterApplyIncidents = null
  for (const fn of [delegate, openRepairApproval, openNavigateApproval, applyDoctorRepair, planDoctorRepair]) fn.mockClear()
  setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
})

afterEach(() => {
  setSystemTime()
})

describe('fresh incident selection', () => {
  it('selects only fresh action-required incident IDs', () => {
    expect(freshActionRequiredIncidents(report([
      incident(),
      incident({ id: 'stale', stale: true }),
      incident({ id: 'watch', disposition: 'watch', status: 'warning' }),
    ])).map((row) => row.id)).toEqual(['health:search:unavailable'])
  })

  it('a sensitivity-demoted incident never escalates (#690)', () => {
    expect(freshActionRequiredIncidents(report([incident({ id: 'demoted', effectiveDisposition: 'watch' })]))).toEqual([])
  })

  it('snoozed action_required incidents never escalate — quiet means quiet', () => {
    expect(freshActionRequiredIncidents(report([
      incident(),
      incident({ ackState: 'snoozed' }),
    ]))).toHaveLength(1)
  })
})

describe('per-incident cover', () => {
  it('skips while a fresh open repair task covers every current incident', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
  })

  it('treats a done or archived covering task as closed once cooldown has passed', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'archived' }
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('a task the human owns (blocked / review) covers indefinitely', async () => {
    requests = [coveringRequest(10 * 24 * 60 * 60_000, { id: 'r-blocked', taskId: 't-blocked' }), coveringRequest(10 * 24 * 60 * 60_000, { id: 'r-review', taskId: 't-review', incidentIds: ['health:runtime:auth-expired'] })]
    taskColumns = { 't-blocked': 'blocked', 't-review': 'review' }
    await escalate([incident(), navigateIncident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(openNavigateApproval).not.toHaveBeenCalled()
  })

  it('re-escalates when a covering active task is stale and incidents are still burning', async () => {
    requests = [coveringRequest(34 * 60 * 60_000)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('still honors the cooldown when a custom stale threshold is shorter', async () => {
    staleAfterMs = 60 * 60_000
    requests = [coveringRequest(2 * 60 * 60_000)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
  })

  it('lets a newer fresh covering request suppress an older stale one', async () => {
    requests = [
      coveringRequest(34 * 60 * 60_000, { id: 'repair-old', taskId: 'task-old' }),
      coveringRequest(60_000, { id: 'repair-new', taskId: 'task-new' }),
    ]
    taskColumns = { 'task-old': 'inProgress', 'task-new': 'todo' }
    await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window even when the previous task is done or missing', async () => {
    requests = [coveringRequest(60_000), coveringRequest(60_000, { id: 'r2', taskId: 'gone', incidentIds: ['health:runtime:auth-expired'] })]
    taskColumns = { 'task-1': 'done' }
    await escalate([incident(), navigateIncident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(openNavigateApproval).not.toHaveBeenCalled()
  })

  it('delegates after cooldown when the previous task is done', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'done' }
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('covers incident by incident: a request covering one of two incidents only suppresses that one', async () => {
    requests = [coveringRequest(60_000)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident(), incident({ id: 'health:runtime:unavailable' })])
    expect(delegate).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      target: { type: 'incidents', reportId: 'health-report-1', ids: ['health:runtime:unavailable'] },
    }))
    expect(await coveredIncidentIds('/tmp/content', Date.now(), cooldownMs, staleAfterMs)).toEqual(new Set(['health:search:unavailable']))
  })
})

describe('policy', () => {
  it('delegates exact fresh instruction/rerun incidents', async () => {
    const outcome = await escalate([incident(), incident({ id: 'health:x:rerun', resolution: { key: 'again', type: 'rerun', label: 'Re-run' } })])
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      accepted: true,
      target: { type: 'incidents', reportId: 'health-report-1', ids: ['health:search:unavailable', 'health:x:rerun'] },
    }))
    expect(outcome?.delegatedIncidentIds).toEqual(['health:search:unavailable', 'health:x:rerun'])
    expect(openRepairApproval).not.toHaveBeenCalled()
  })

  it('auto-applies safe repair items and never opens a task for the incidents they fix', async () => {
    planItems = [item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe', incidentIds: ['health:search:index-corrupt'] })]
    afterApplyIncidents = []
    const outcome = await escalate([repairIncident()])
    expect(applyDoctorRepair).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', itemIds: ['search.restart:restart'], confirmedItemIds: [] }))
    expect(outcome?.autoApplied).toEqual(['health:search:index-corrupt'])
    expect(openRepairApproval).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  it('a safe repair that leaves the incident burning falls through to the rest of the policy on the fresh report', async () => {
    planItems = [item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe' })]
    afterApplyIncidents = [repairIncident()]
    const outcome = await escalate([repairIncident()])
    expect(applyDoctorRepair).toHaveBeenCalledTimes(1)
    expect(outcome?.autoApplied).toEqual([])
    // No non-safe proposal for it → delegated, against the post-apply report.
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:index-corrupt'] }) }))
  })

  it('non-safe repair proposals become ONE review task with a health-repair approval holding only those items', async () => {
    planItems = [item({}), item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe', incidentIds: ['health:search:other'], observationIds: ['health.search:other'] })]
    afterApplyIncidents = [repairIncident()]
    const outcome = await escalate([repairIncident()])
    expect(openRepairApproval).toHaveBeenCalledTimes(1)
    const call = openRepairApproval.mock.calls[0]![0]
    expect(call.incidents.map((row) => row.id)).toEqual(['health:search:index-corrupt'])
    expect(call.items.map((row) => row.id)).toEqual(['search.rebuild:rebuild'])
    expect(outcome?.repairApprovalTaskId).toBe('task-repair-approval')
    expect(delegate).not.toHaveBeenCalled()
  })

  it('navigate incidents get one health-navigate approval each; the rest is delegated in the same cycle', async () => {
    planItems = [item({})]
    const outcome = await escalate([repairIncident(), navigateIncident(), navigateIncident('health:runtime:auth-expired-2'), incident()])
    expect(openRepairApproval).toHaveBeenCalledTimes(1)
    expect(openNavigateApproval).toHaveBeenCalledTimes(2)
    expect(outcome?.navigateApprovalTaskIds).toHaveLength(2)
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:unavailable'] }) }))
  })

  it('a repair incident with no plan item is delegated, not silently dropped', async () => {
    planItems = []
    await escalate([repairIncident()])
    expect(openRepairApproval).not.toHaveBeenCalled()
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:index-corrupt'] }) }))
  })

  it('planning failure degrades to delegation for everything uncovered', async () => {
    planThrows = true
    await escalate([repairIncident(), incident()])
    expect(applyDoctorRepair).not.toHaveBeenCalled()
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:index-corrupt', 'health:search:unavailable'] }) }))
  })

  it('contains delegation failures so cron diagnostics still complete', async () => {
    delegate.mockImplementationOnce(async () => { throw new Error('delegate unavailable') })
    await expect(escalate([incident()])).resolves.toBeDefined()
  })

  it('does nothing when escalation is off, and skips onboarding-only state when on', async () => {
    mode = false
    expect(await escalate([incident()])).toBeNull()
    expect(delegate).not.toHaveBeenCalled()

    mode = true
    expect(await escalate([incident({ id: 'core:system:onboarding-required' })])).toBeNull()
    expect(delegate).not.toHaveBeenCalled()
    expect(planDoctorRepair).not.toHaveBeenCalled()
  })
})
