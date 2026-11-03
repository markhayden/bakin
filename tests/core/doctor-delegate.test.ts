import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-delegate-'))
let taskSeq = 0
const liveTasks = new Set<string>()
const createTaskWithEffects = mock(async () => {
  taskSeq += 1
  const id = taskSeq === 1 ? 'task-doctor-repair' : `task-doctor-repair-${taskSeq}`
  liveTasks.add(id)
  return { id }
})
const dispatchSingleTask = mock(async () => {})
const report = {
  id: 'health-report-1',
  incidents: [{
    id: 'health:search:unavailable', status: 'error', disposition: 'action_required',
    effectiveDisposition: 'action_required',
    title: 'Search is unavailable', impact: 'Search requests fail.', resources: [],
    resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'health.restart' },
    observationIds: ['health.search:engine'], observedAt: '2026-07-13T12:00:00.000Z', staleAt: '2026-07-13T12:10:00.000Z', stale: false,
  }],
}
const plan = {
  planId: 'repair-plan-1', basedOnReportId: report.id,
  target: { type: 'all_actionable', reportId: report.id },
  createdAt: '2026-07-13T12:00:00.000Z', expiresAt: '2026-07-13T12:10:00.000Z', items: [],
}

mock.module('../../src/core/doctor-report-cache', () => ({ getHealthReport: () => report }))
mock.module('../../src/core/doctor-repair', () => ({ planDoctorRepair: async () => plan }))
mock.module('../../src/core/task-service', () => ({
  createTaskWithEffects,
  getTaskDetails: async (id: string) => (liveTasks.has(id) ? { task: { id }, column: 'todo' } : null),
}))
mock.module('../../src/core/dispatch', () => ({ dispatchSingleTask }))
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { agents: { list: async () => [{ id: 'main' }] } } }) }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => ({ runtime: { agents: { list: async () => [{ id: 'main' }] } } }) }))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))

import { delegateDoctorRepair, type DoctorDelegateOutcome, type DoctorDelegateReport } from '../../src/core/doctor-delegate'
import { heldIncidentIds, incidentHolder, reserveIncidents, resetIncidentReservationsForTests } from '../../src/core/doctor-reservations'
import { getDoctorRepairRequest, listDoctorRepairRequests, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'

/** Every pre-#896 case expects a written outcome; a refusal here is a test failure. */
function outcome(report: DoctorDelegateReport): DoctorDelegateOutcome {
  if (report.status === 'repair_in_flight') throw new Error(`unexpected refusal: ${report.overlapping.join(', ')} held by ${report.heldBy}`)
  return report
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  resetIncidentReservationsForTests()
  createTaskWithEffects.mockClear()
  taskSeq = 0
  liveTasks.clear()
  dispatchSingleTask.mockClear()
})
afterEach(() => rmSync(testDir, { recursive: true, force: true }))

describe('structured Health delegation', () => {
  it('persists stable incident identity without task mutation before acceptance', async () => {
    const result = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: false })
    expect(result.status).toBe('confirmation_required')
    expect(outcome(result).request).toMatchObject({ version: 2, incidentIds: ['health:search:unavailable'], observationIds: ['health.search:engine'] })
    expect(createTaskWithEffects).not.toHaveBeenCalled()
    expect(getDoctorRepairRequest(testDir, outcome(result).request.id)?.incidentIds).toEqual(['health:search:unavailable'])
  })

  it('creates one linked task with stable IDs and kicks dispatch after acceptance', async () => {
    const result = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(result.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledWith(expect.objectContaining({
      assignee: 'main',
      description: expect.stringContaining('health:search:unavailable'),
      source: expect.objectContaining({ entityId: outcome(result).request.id }),
    }))
    expect(dispatchSingleTask).toHaveBeenCalledWith('task-doctor-repair', testDir, 3737, 'kick')
    expect(listDoctorRepairRequests(testDir)).toHaveLength(1)
  })

  it('an incident an open repair task already works is never delegated twice (spec D-G3)', async () => {
    const first = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    const again = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(again.status).toBe('already_delegated')
    expect(outcome(again).request).toMatchObject({ id: outcome(first).request.id, taskId: 'task-doctor-repair' })
    expect(again.incidents.map((incident) => incident.id)).toEqual(['health:search:unavailable'])
    expect(createTaskWithEffects).toHaveBeenCalledTimes(1)
    expect(listDoctorRepairRequests(testDir)).toHaveLength(1)

    // Once that work is verified, a recurrence is a new episode.
    updateDoctorRepairRequest(testDir, outcome(first).request.id, (r) => ({ ...r, status: 'verified' }))
    const recurrence = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(recurrence.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledTimes(2)
  })

  it('takes a caller\'s reservation as a hand-off, holds it through persistence, releases once the request is written (#896)', async () => {
    reserveIncidents(['health:search:unavailable'], 'escalation:cycle-1')
    let holderWhileCreatingTask: string | undefined
    createTaskWithEffects.mockImplementationOnce(async () => {
      holderWhileCreatingTask = incidentHolder('health:search:unavailable')
      taskSeq += 1
      const task = { id: `task-doctor-repair-${taskSeq}` }
      liveTasks.add(task.id)
      return task as never
    })
    const result = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true, reservation: 'escalation:cycle-1' })
    expect(result.status).toBe('sent')
    expect(holderWhileCreatingTask).toMatch(/^delegation:/)
    expect(getDoctorRepairRequest(testDir, outcome(result).request.id)?.taskId).toBeDefined()
    expect(heldIncidentIds().size).toBe(0)
  })

  it('the plain path holds its incidents only while persisting, then releases them', async () => {
    let holderWhileCreatingTask: string | undefined
    createTaskWithEffects.mockImplementationOnce(async () => {
      holderWhileCreatingTask = incidentHolder('health:search:unavailable')
      taskSeq += 1
      const task = { id: `task-doctor-repair-${taskSeq}` }
      liveTasks.add(task.id)
      return task as never
    })
    await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(holderWhileCreatingTask).toMatch(/^delegation:/)
    expect(heldIncidentIds().size).toBe(0)
  })

  it('is refused — nothing written — while a repair holds a targeted incident (#896 D3.3)', async () => {
    reserveIncidents(['health:search:unavailable'], 'repair:plan-3:search.rebuild:rebuild')
    const result = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(result).toEqual({
      status: 'repair_in_flight',
      incidents: [expect.objectContaining({ id: 'health:search:unavailable' })],
      overlapping: ['health:search:unavailable'],
      heldBy: 'repair:plan-3:search.rebuild:rebuild',
    })
    expect(createTaskWithEffects).not.toHaveBeenCalled()
    expect(listDoctorRepairRequests(testDir)).toHaveLength(0)
    // The foreign hold is untouched.
    expect(incidentHolder('health:search:unavailable')).toBe('repair:plan-3:search.rebuild:rebuild')
  })

  it.each([
    ['a fresh reservation', undefined],
    ['a handed-over reservation', 'escalation:cycle-1'],
  ])('releases %s when the request write itself fails (#896 review)', async (_label, reservation) => {
    if (reservation) reserveIncidents(['health:search:unavailable'], reservation)
    mkdirSync(testDir, { recursive: true })
    chmodSync(testDir, 0o500) // the request directory cannot be created → the first write throws
    try {
      const failure = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true, ...(reservation ? { reservation } : {}) }).catch((err: unknown) => err)
      expect(failure).toBeInstanceOf(Error)
      expect(createTaskWithEffects).not.toHaveBeenCalled()
      expect(heldIncidentIds().size).toBe(0)
    } finally {
      chmodSync(testDir, 0o700)
    }
  })

  it('concurrent delegations of the same incident open ONE task', async () => {
    const [a, b] = await Promise.all([
      delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true }),
      delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true }),
    ])
    expect([a.status, b.status].sort()).toEqual(['already_delegated', 'sent'])
    expect(createTaskWithEffects).toHaveBeenCalledTimes(1)
  })

  it('a request whose task was deleted works nothing: the incident is delegated again', async () => {
    await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    liveTasks.clear()
    const again = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(again.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledTimes(2)
  })

  it('falls back past a newer request whose task was deleted to an older one that still exists', async () => {
    const older = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    // A newer request for the same incident (a state earlier builds allowed), whose task is then deleted.
    updateDoctorRepairRequest(testDir, outcome(older).request.id, (r) => ({ ...r, createdAt: new Date(Date.now() - 60_000).toISOString() }))
    liveTasks.clear()
    const newer = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(newer.status).toBe('sent')
    liveTasks.clear()
    liveTasks.add('task-doctor-repair') // the older task survives, the newer one is gone
    const again = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(again.status).toBe('already_delegated')
    expect(outcome(again).request.id).toBe(outcome(older).request.id)
    expect(createTaskWithEffects).toHaveBeenCalledTimes(2)
  })

  it('a FUTURE-dated request works nothing: delegation is not suppressed by it (#898)', async () => {
    const first = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    updateDoctorRepairRequest(testDir, outcome(first).request.id, (r) => ({ ...r, createdAt: new Date(Date.now() + 24 * 3_600_000).toISOString() }))
    const again = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(again.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledTimes(2)
  })

  it('the repair brief carries integrity guardrails and each incident\'s sanctioned fix (margo forgery, 2026-09-21)', async () => {
    await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    const call = (createTaskWithEffects.mock.calls.at(-1) as unknown as [{ description: string }])[0]
    const brief = call.description

    // Sanctioned fix surfaced per incident (this one is a one-click repair).
    expect(brief).toContain('Sanctioned fix: one-click repair "Restart"')
    // The non-negotiables that make fabrication out of bounds.
    expect(brief).toContain('INTEGRITY RULES')
    expect(brief).toContain('NEVER create, edit, or fabricate Bakin-internal state by hand')
    expect(brief).toContain('A clearly reported failure is a SUCCESS outcome')
    expect(brief).toContain('Never edit anything to make a check pass')
    // Silencing is not fixing (#898).
    expect(brief).toContain('do not acknowledge or snooze Health incidents')
    expect(brief).toContain('do not change doctor or escalation settings')
    expect(brief).toContain('do not move this task to review to make it go quiet')
  })
})
