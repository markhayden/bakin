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
type Req = { id: string; kind?: 'delegate' | 'approval-repair' | 'approval-navigate' | 'operator-review'; incidentIds: string[]; taskId?: string; createdAt: string; status: string; approvalId?: string; events: Array<{ ts: string; type: string; message: string; data?: Record<string, unknown> }> }
let requests: Req[] = []
let liveRuns = new Set<string>()
let onTaskRead = () => {}
const escalateTaskToReview = mock((taskId: string, _reason: string) => {
  const from = taskColumns[taskId]!
  if (from === 'review' || from === 'blocked') return null
  taskColumns[taskId] = 'review'
  return from
})
const reopenIfLeavingDone = mock((_taskId: string, _to: string, _agent: string, _channel?: string) => {})
const reannounceApproval = mock((_approvalId: string) => true)
const attachResurfaceApproval = mock((input: { request: Req }) => {
  const request = requests.find((r) => r.id === input.request.id)!
  request.approvalId = `health-navigate:${request.id}`
  return { approvalId: request.approvalId }
})
let taskColumns: Record<string, string> = {}
let planItems: HealthRepairPlanItem[] = []
let planThrows = false
/** Incident ids the (mocked) safe apply leaves burning. */
let afterApplyIncidents: HealthIncident[] | null = null

const delegate = mock(async () => ({ status: 'sent' }))
const openRepairApproval = mock(async (_input: { incidents: HealthIncident[]; items: HealthRepairPlanItem[] }) => ({ taskId: 'task-repair-approval' }))
const openNavigateApproval = mock(async (_input: { incident: HealthIncident }) => ({ taskId: `task-nav-${openNavigateApproval.mock.calls.length}` }))
const openOperatorReview = mock(async (_input: { incidents: HealthIncident[]; reason: unknown }) => ({ request: { id: 'repair-review' }, taskId: 'task-operator-review' }))
const startDoctorRepair = mock(async (_options: Record<string, unknown>) => ({ operationId: 'op-repair', bootId: 'boot-1' }))
const awaitDoctorRepair = mock(async () => ({
  view: { id: 'op-repair', status: 'succeeded' },
  report: { report: report(afterApplyIncidents ?? []), results: [], affectedCheckIds: [], remainingIncidentIds: [], verifiedReportId: 'health-report-2', planId: 'plan-1', basedOnReportId: 'health-report-1' },
}))
const planDoctorRepair = mock(async () => {
  if (planThrows) throw new Error('action unregistered')
  return { planId: 'plan-1', basedOnReportId: 'health-report-1', target: { type: 'incidents', reportId: 'health-report-1', ids: ['x'] }, createdAt: '', expiresAt: '', items: planItems }
})

mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { escalation: mode, escalationCooldownMs: cooldownMs, escalationStaleAfterMs: staleAfterMs } }),
}))
mock.module('../../src/core/doctor-repair-store', () => ({
  listDoctorRepairRequests: () => requests,
  getDoctorRepairRequest: (_dir: string, id: string) => requests.find((r) => r.id === id) ?? null,
  updateDoctorRepairRequest: (_dir: string, id: string, fn: (r: Req) => Req) => {
    const at = requests.findIndex((r) => r.id === id)
    requests[at] = fn(requests[at]!)
    return requests[at]
  },
}))
mock.module('../../src/core/execution-ledger', () => ({ getLiveRun: (taskId: string) => (liveRuns.has(taskId) ? { runId: `run-${taskId}` } : null) }))
mock.module('../../src/core/task-store', () => ({
  escalateTaskToReview,
  getTaskWithColumn: (taskId: string) => { onTaskRead(); return taskId in taskColumns ? { column: taskColumns[taskId] } : null },
}))
mock.module('../../src/core/approvals', () => ({ reannounceApproval }))
mock.module('../../src/core/task-service', () => ({
  reopenIfLeavingDone,
}))
mock.module('../../src/core/doctor-delegate', () => ({ delegateDoctorRepair: delegate }))
mock.module('../../src/core/doctor-approvals', () => ({ openRepairApproval, openNavigateApproval, openOperatorReview, attachResurfaceApproval }))
// The fingerprint formula is the real one: the reservation tests pin that
// escalation hands the safe subset over under EXACTLY the token
// startDoctorRepair reserves with.
const repairFingerprint = (planId: string, itemIds: readonly string[]) => `repair:${planId}:${[...itemIds].sort().join(',')}`
mock.module('../../src/core/doctor-repair', () => ({ planDoctorRepair, startDoctorRepair, awaitDoctorRepair, repairFingerprint }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

import { assessRepairCoverage, escalateCronIncidents, freshActionRequiredIncidents } from '../../src/core/doctor-escalation'
import { heldIncidentIds, incidentHolder, reserveIncidents, resetIncidentReservationsForTests } from '../../src/core/doctor-reservations'
import { waitUntil } from '../helpers/wait'

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

function coveringRequest(ageMs: number, overrides: Partial<Req> = {}): Req {
  return { id: 'repair-1', incidentIds: ['health:search:unavailable'], taskId: 'task-1', createdAt: new Date(Date.now() - ageMs).toISOString(), status: 'sent', events: [], ...overrides }
}

const covered = async (fresh: string[]) => (await assessRepairCoverage('/tmp/content', new Set(fresh), Date.now(), cooldownMs, staleAfterMs)).covered

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
  liveRuns = new Set()
  onTaskRead = () => {}
  for (const fn of [delegate, openRepairApproval, openNavigateApproval, openOperatorReview, startDoctorRepair, awaitDoctorRepair, planDoctorRepair, escalateTaskToReview, reopenIfLeavingDone, reannounceApproval, attachResurfaceApproval]) fn.mockClear()
  resetIncidentReservationsForTests()
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

const HOUR = 60 * 60_000

describe('per-incident cover (bounded, resurfacing — spec D-G1/D-G3)', () => {
  it('a fresh open repair task covers inside the window', async () => {
    requests = [coveringRequest(7 * HOUR)]
    taskColumns = { 'task-1': 'inProgress' }
    const outcome = await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(escalateTaskToReview).not.toHaveBeenCalled()
    expect(outcome?.resurfacedTaskIds).toEqual([])
  })

  it('a stale open delegated task RESURFACES (to Review, approval attached) — never a duplicate task', async () => {
    requests = [coveringRequest(34 * HOUR)]
    taskColumns = { 'task-1': 'inProgress' }
    const outcome = await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(escalateTaskToReview).toHaveBeenCalledWith('task-1', expect.stringContaining('not fixed after 12h'))
    expect(attachResurfaceApproval).toHaveBeenCalledTimes(1)
    expect(outcome?.resurfacedTaskIds).toEqual(['task-1'])
    expect(requests[0]!.events.map((e) => e.type)).toEqual(['resurfaced'])
  })

  it('a task the human owns no longer covers forever: past the window its approval is re-announced', async () => {
    requests = [coveringRequest(10 * 24 * HOUR, { id: 'r-review', taskId: 't-review', incidentIds: ['health:runtime:auth-expired'], approvalId: 'health-navigate:r-review' })]
    taskColumns = { 't-review': 'review' }
    const outcome = await escalate([navigateIncident()])
    expect(reannounceApproval).toHaveBeenCalledWith('health-navigate:r-review')
    expect(attachResurfaceApproval).not.toHaveBeenCalled()
    expect(openNavigateApproval).not.toHaveBeenCalled()
    expect(outcome?.resurfacedTaskIds).toEqual(['t-review'])
  })

  it('one announcement per window: the next cycle inside the window is quiet, the one after it resurfaces again', async () => {
    requests = [coveringRequest(34 * HOUR, { approvalId: 'health-repair:repair-1:1' })]
    taskColumns = { 'task-1': 'review' }
    await escalate([incident()])
    expect(reannounceApproval).toHaveBeenCalledTimes(1)

    setSystemTime(new Date(Date.now() + 6 * HOUR))
    await escalate([incident()])
    expect(reannounceApproval).toHaveBeenCalledTimes(1)

    setSystemTime(new Date(Date.now() + 7 * HOUR))
    await escalate([incident()])
    expect(reannounceApproval).toHaveBeenCalledTimes(2)
    expect(delegate).not.toHaveBeenCalled()
  })

  it('moving the task between columns never resets the window (and a restart re-reads the mark)', async () => {
    requests = [coveringRequest(13 * HOUR)]
    taskColumns = { 'task-1': 'todo' }
    // The task was shuffled around recently — irrelevant: the window runs from the request.
    taskColumns['task-1'] = 'inProgress'
    const fresh = (await assessRepairCoverage('/tmp/content', new Set(['health:search:unavailable']), Date.now(), cooldownMs, staleAfterMs))
    expect(fresh.resurface.map((r) => r.reason)).toEqual(['stale'])
  })

  it('a task closed while its incident still fails is reopened in Review (same task)', async () => {
    requests = [coveringRequest(7 * HOUR)]
    taskColumns = { 'task-1': 'done' }
    const outcome = await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(escalateTaskToReview).toHaveBeenCalledWith('task-1', expect.stringContaining('closed, but its incident still fails'))
    expect(outcome?.resurfacedTaskIds).toEqual(['task-1'])
  })

  it('reopening from Done goes through the audited reopen (the completion row is cleared)', async () => {
    requests = [coveringRequest(7 * HOUR)]
    taskColumns = { 'task-1': 'done' }
    await escalate([incident()])
    expect(reopenIfLeavingDone).toHaveBeenCalledWith('task-1', 'review', 'health', 'system')
  })

  it('a stale BLOCKED task stays blocked: log + announce, no move, no reopen', async () => {
    requests = [coveringRequest(34 * HOUR)]
    taskColumns = { 'task-1': 'blocked' }
    const outcome = await escalate([incident()])
    expect(escalateTaskToReview).toHaveBeenCalledTimes(1)
    expect(taskColumns['task-1']).toBe('blocked')
    expect(reopenIfLeavingDone).not.toHaveBeenCalled()
    expect(attachResurfaceApproval).toHaveBeenCalledTimes(1)
    expect(outcome?.resurfacedTaskIds).toEqual(['task-1'])
  })

  it('an APPLYING request stays covered past the window and is never handed back mid-run', async () => {
    requests = [coveringRequest(34 * HOUR, { status: 'applying', approvalId: 'health-repair:repair-1:1' })]
    taskColumns = { 'task-1': 'review' }
    const outcome = await escalate([incident()])
    expect(escalateTaskToReview).not.toHaveBeenCalled()
    expect(reannounceApproval).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
    expect(outcome?.resurfacedTaskIds).toEqual([])
  })

  it('an open operator-review request covers its incidents like any other (#896 D3.4)', async () => {
    requests = [coveringRequest(1 * HOUR, { kind: 'operator-review' })]
    taskColumns = { 'task-1': 'review' }
    expect(await covered(['health:search:unavailable'])).toEqual(new Set(['health:search:unavailable']))
    await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(openRepairApproval).not.toHaveBeenCalled()
  })

  it('resurfaces an operator-review task with its own copy and NEVER attaches a navigate approval (#896 D3.4)', async () => {
    requests = [coveringRequest(34 * HOUR, { kind: 'operator-review' })]
    taskColumns = { 'task-1': 'todo' }
    await escalate([incident()])
    expect(escalateTaskToReview).toHaveBeenCalledWith('task-1', expect.stringMatching(/could not be automated and still needs you/))
    expect(attachResurfaceApproval).not.toHaveBeenCalled()
    expect(reannounceApproval).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  it('re-judges current state before mutating: a request verified after the assessment is not resurfaced', async () => {
    requests = [coveringRequest(34 * HOUR)]
    taskColumns = { 'task-1': 'inProgress' }
    // Auto-close lands between the assessment and the resurface: the first
    // task read (the assessment) flips the request to verified.
    onTaskRead = () => { requests[0] = { ...requests[0]!, status: 'verified' }; onTaskRead = () => {} }
    const outcome = await escalate([incident()])
    expect(escalateTaskToReview).not.toHaveBeenCalled()
    expect(attachResurfaceApproval).not.toHaveBeenCalled()
    expect(outcome?.resurfacedTaskIds).toEqual([])
  })

  it('an invalid or future window mark never extends cover — it is ignored', async () => {
    const mark = (ts: string) => ({ ts, type: 'resurfaced', message: 'x' })
    for (const ts of ['not-a-time', new Date(Date.now() + 48 * HOUR).toISOString()]) {
      requests = [coveringRequest(34 * HOUR, { events: [mark(ts)] })]
      taskColumns = { 'task-1': 'inProgress' }
      const fresh = await assessRepairCoverage('/tmp/content', new Set(['health:search:unavailable']), Date.now(), cooldownMs, staleAfterMs)
      expect(fresh.resurface.map((r) => r.reason)).toEqual(['stale'])
    }
  })

  it('overlapping cycles are serialized: one expired window announces once', async () => {
    requests = [coveringRequest(34 * HOUR, { approvalId: 'health-repair:repair-1:1' })]
    taskColumns = { 'task-1': 'review' }
    const [a, b] = await Promise.all([escalate([incident()]), escalate([incident()])])
    expect(reannounceApproval).toHaveBeenCalledTimes(1)
    expect([...(a?.resurfacedTaskIds ?? []), ...(b?.resurfacedTaskIds ?? [])]).toEqual(['task-1'])
    expect(requests[0]!.events.filter((e) => e.type === 'resurfaced')).toHaveLength(1)
  })

  it('a VERIFIED request covers nothing: a recurrence is a new episode', async () => {
    requests = [coveringRequest(7 * HOUR, { status: 'verified' })]
    taskColumns = { 'task-1': 'done' }
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
    expect(escalateTaskToReview).not.toHaveBeenCalled()
  })

  it('an in-flight run is never yanked: the task stays covered and is not moved', async () => {
    requests = [coveringRequest(34 * HOUR)]
    taskColumns = { 'task-1': 'inProgress' }
    liveRuns.add('task-1')
    const outcome = await escalate([incident()])
    expect(escalateTaskToReview).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
    expect(outcome?.resurfacedTaskIds).toEqual([])
  })

  it('a missing task covers nothing after the cooldown (a new request may open)', async () => {
    requests = [coveringRequest(7 * HOUR, { taskId: 'gone' })]
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('still honors the cooldown when a custom stale threshold is shorter', async () => {
    staleAfterMs = HOUR
    requests = [coveringRequest(2 * HOUR)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(escalateTaskToReview).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window even when the previous task is done or missing', async () => {
    requests = [coveringRequest(60_000), coveringRequest(60_000, { id: 'r2', taskId: 'gone', incidentIds: ['health:runtime:auth-expired'] })]
    taskColumns = { 'task-1': 'done' }
    await escalate([incident(), navigateIncident()])
    expect(delegate).not.toHaveBeenCalled()
    expect(openNavigateApproval).not.toHaveBeenCalled()
  })

  it('covers incident by incident: a request covering one of two incidents only suppresses that one', async () => {
    requests = [coveringRequest(60_000)]
    taskColumns = { 'task-1': 'inProgress' }
    await escalate([incident(), incident({ id: 'health:runtime:unavailable' })])
    expect(delegate).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      target: { type: 'incidents', reportId: 'health-report-1', ids: ['health:runtime:unavailable'] },
    }))
    expect(await covered(['health:search:unavailable', 'health:runtime:unavailable'])).toEqual(new Set(['health:search:unavailable']))
  })

  it('a future-dated request covers nothing — not even one a human owns (#898)', async () => {
    requests = [
      coveringRequest(-24 * HOUR, { id: 'r-future', taskId: 't-blocked' }),
      coveringRequest(0, { id: 'r-undated', taskId: 't-review', incidentIds: ['health:runtime:auth-expired'], createdAt: 'whenever' }),
    ]
    taskColumns = { 't-blocked': 'blocked', 't-review': 'review' }
    expect(await covered(['health:search:unavailable', 'health:runtime:auth-expired'])).toEqual(new Set())
    await escalate([incident()])
    expect(delegate).toHaveBeenCalledTimes(1)
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
    expect(startDoctorRepair).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', itemIds: ['search.restart:restart'], confirmedItemIds: [], origin: 'system' }))
    expect(awaitDoctorRepair).toHaveBeenCalledWith('op-repair')
    expect(outcome?.autoApplied).toEqual(['health:search:index-corrupt'])
    expect(openRepairApproval).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  it('a safe repair that leaves the incident burning goes to the OPERATOR with a receipt, never to an agent (#896 D3.4)', async () => {
    planItems = [item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe' })]
    afterApplyIncidents = [repairIncident()]
    const outcome = await escalate([repairIncident()])
    expect(startDoctorRepair).toHaveBeenCalledTimes(1)
    expect(outcome?.autoApplied).toEqual([])
    expect(delegate).not.toHaveBeenCalled()
    expect(openOperatorReview).toHaveBeenCalledWith(expect.objectContaining({
      incidents: [expect.objectContaining({ id: 'health:search:index-corrupt' })],
      reason: { failure: expect.objectContaining({ operationId: 'op-repair', stage: 'verify', error: 'applied, but the incident still reproduces' }) },
    }))
    expect(outcome?.operatorReviewTaskId).toBe('task-operator-review')
  })

  it('a failed safe apply row becomes the receipt on the health-repair approval when a non-safe proposal exists (#896 D3.4a)', async () => {
    planItems = [
      item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe' }),
      item({}),
    ]
    afterApplyIncidents = [repairIncident()]
    awaitDoctorRepair.mockImplementationOnce(async () => ({
      view: { id: 'op-repair', status: 'failed' },
      report: { report: report([repairIncident()]), results: [{ itemId: 'search.restart:restart', actionId: 'search.restart', status: 'failed', message: 'download stalled', affectedCheckIds: [], changes: [] }], affectedCheckIds: [], remainingIncidentIds: [], verifiedReportId: 'health-report-2', planId: 'plan-1', basedOnReportId: 'health-report-1' },
    }) as never)
    await escalate([repairIncident()])
    expect(openRepairApproval).toHaveBeenCalledWith(expect.objectContaining({
      failure: expect.objectContaining({ operationId: 'op-repair', stage: 'search.restart', error: 'download stalled' }),
    }))
    expect(openOperatorReview).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  it('no report beats any proposal: a safe + non-safe plan for one incident still goes to the operator when the attempt died (#896 review)', async () => {
    planItems = [
      item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe' }),
      item({}), // a non-safe proposal for the same incident
    ]
    awaitDoctorRepair.mockImplementationOnce(async () => ({ view: { id: 'op-repair', status: 'failed', outcome: { code: 'unexpected', message: 'worker died' } }, report: null }) as never)
    let holderDuringReview: string | undefined
    openOperatorReview.mockImplementationOnce(async () => {
      holderDuringReview = incidentHolder('health:search:index-corrupt')
      return { request: { id: 'repair-review' }, taskId: 'task-operator-review' }
    })
    await escalate([repairIncident()])
    expect(openRepairApproval).not.toHaveBeenCalled()
    expect(openOperatorReview).toHaveBeenCalledWith(expect.objectContaining({ reason: { failure: expect.objectContaining({ stage: 'failed', error: 'worker died' }) } }))
    // No window: the incident is back under the cycle's token before the disposition is written.
    expect(holderDuringReview).toMatch(/^escalation:/)
  })

  it('an auto-repair that settles WITHOUT a report hands its incidents to the operator instead of ending the cycle (#896 D3.4b)', async () => {
    planItems = [item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe' })]
    awaitDoctorRepair.mockImplementationOnce(async () => ({ view: { id: 'op-repair', status: 'cancelled', outcome: { code: 'cancelled', message: 'cancelled before apply' } }, report: null }) as never)
    const outcome = await escalate([repairIncident(), incident()])
    expect(openOperatorReview).toHaveBeenCalledWith(expect.objectContaining({
      reason: { failure: expect.objectContaining({ operationId: 'op-repair', stage: 'cancelled', error: 'cancelled before apply' }) },
    }))
    // The instruction-type incident is still delegated in the same cycle.
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:unavailable'] }) }))
    expect(outcome?.operatorReviewTaskId).toBe('task-operator-review')
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

  it('a repair incident with no plan item goes to the operator, not silently dropped and not to an agent (#896 D3.4)', async () => {
    planItems = []
    await escalate([repairIncident()])
    expect(openRepairApproval).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
    expect(openOperatorReview).toHaveBeenCalledWith(expect.objectContaining({ reason: { plannerError: 'no repair action was proposed for this incident' } }))
  })

  it('planning failure: repair incidents go to the operator with the planner error; everything else is still delegated', async () => {
    planThrows = true
    await escalate([repairIncident(), incident()])
    expect(startDoctorRepair).not.toHaveBeenCalled()
    expect(openOperatorReview).toHaveBeenCalledWith(expect.objectContaining({
      incidents: [expect.objectContaining({ id: 'health:search:index-corrupt' })],
      reason: { plannerError: 'action unregistered' },
    }))
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:unavailable'] }) }))
  })

  describe('incident reservations (#896 D3.2)', () => {
    it('never judges an incident a repair or delegation already holds', async () => {
      reserveIncidents(['health:search:index-corrupt'], 'repair:plan-9:x')
      await escalate([repairIncident(), incident()])
      expect(planDoctorRepair).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:unavailable'] }) }))
      expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ ids: ['health:search:unavailable'] }) }))
      // The foreign hold survives the cycle untouched; the cycle's own hold is gone.
      expect([...heldIncidentIds()]).toEqual(['health:search:index-corrupt'])
      expect(incidentHolder('health:search:index-corrupt')).toBe('repair:plan-9:x')
    })

    it('refuses a UI repair that starts while the cycle is still planning', async () => {
      let finishPlanning!: () => void
      planDoctorRepair.mockImplementationOnce(() => new Promise((resolve) => {
        finishPlanning = () => resolve({ planId: 'plan-1', basedOnReportId: 'health-report-1', target: { type: 'incidents', reportId: 'health-report-1', ids: ['x'] }, createdAt: '', expiresAt: '', items: [] })
      }))
      const cycle = escalate([repairIncident()])
      await waitUntil(() => planDoctorRepair.mock.calls.length === 1, { label: 'escalation reached planning' })
      // A tab's Apply (startDoctorRepair reserves under its fingerprint) lands mid-await.
      expect(reserveIncidents(['health:search:index-corrupt'], 'repair:plan-7:ui')).toEqual({
        status: 'refused', overlapping: ['health:search:index-corrupt'], heldBy: expect.stringMatching(/^escalation:/),
      })
      finishPlanning()
      await cycle
      expect(heldIncidentIds().size).toBe(0)
    })

    it('hands the safe subset to the repair operation and the rest to the delegation, then holds nothing', async () => {
      planItems = [item({ id: 'search.restart:restart', actionId: 'search.restart', safety: 'safe', incidentIds: ['health:search:index-corrupt'] })]
      afterApplyIncidents = [incident()] // the safe apply fixes index-corrupt; 'unavailable' still burns → delegated
      let holderDuringApply: string | undefined
      startDoctorRepair.mockImplementationOnce(async () => {
        holderDuringApply = incidentHolder('health:search:index-corrupt')
        return { operationId: 'op-repair', bootId: 'boot-1' }
      })
      let holderDuringDelegate: string | undefined
      delegate.mockImplementationOnce(async () => {
        holderDuringDelegate = incidentHolder('health:search:unavailable')
        return { status: 'sent' }
      })
      await escalate([repairIncident(), incident()])
      // The auto-repair ran under the SAME token startDoctorRepair reserves with — it attached, never raced.
      expect(holderDuringApply).toBe('repair:plan-1:search.restart:restart')
      expect(holderDuringDelegate).toMatch(/^escalation:/)
      expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ reservation: expect.stringMatching(/^escalation:/) }))
      expect(heldIncidentIds().size).toBe(0)
    })

    it('releases everything it held when planning and delegation both fail', async () => {
      planThrows = true
      delegate.mockImplementationOnce(async () => { throw new Error('delegate unavailable') })
      await escalate([repairIncident(), incident()])
      expect(heldIncidentIds().size).toBe(0)
    })
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
