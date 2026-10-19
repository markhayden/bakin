import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
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

import { delegateDoctorRepair } from '../../src/core/doctor-delegate'
import { getDoctorRepairRequest, listDoctorRepairRequests, updateDoctorRepairRequest } from '../../src/core/doctor-repair-store'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
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
    expect(result.request).toMatchObject({ version: 2, incidentIds: ['health:search:unavailable'], observationIds: ['health.search:engine'] })
    expect(createTaskWithEffects).not.toHaveBeenCalled()
    expect(getDoctorRepairRequest(testDir, result.request.id)?.incidentIds).toEqual(['health:search:unavailable'])
  })

  it('creates one linked task with stable IDs and kicks dispatch after acceptance', async () => {
    const result = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(result.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledWith(expect.objectContaining({
      assignee: 'main',
      description: expect.stringContaining('health:search:unavailable'),
      source: expect.objectContaining({ entityId: result.request.id }),
    }))
    expect(dispatchSingleTask).toHaveBeenCalledWith('task-doctor-repair', testDir, 3737, 'kick')
    expect(listDoctorRepairRequests(testDir)).toHaveLength(1)
  })

  it('an incident an open repair task already works is never delegated twice (spec D-G3)', async () => {
    const first = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    const again = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(again.status).toBe('already_delegated')
    expect(again.request).toMatchObject({ id: first.request.id, taskId: 'task-doctor-repair' })
    expect(again.incidents.map((incident) => incident.id)).toEqual(['health:search:unavailable'])
    expect(createTaskWithEffects).toHaveBeenCalledTimes(1)
    expect(listDoctorRepairRequests(testDir)).toHaveLength(1)

    // Once that work is verified, a recurrence is a new episode.
    updateDoctorRepairRequest(testDir, first.request.id, (r) => ({ ...r, status: 'verified' }))
    const recurrence = await delegateDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })
    expect(recurrence.status).toBe('sent')
    expect(createTaskWithEffects).toHaveBeenCalledTimes(2)
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
