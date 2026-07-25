import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-delegate-'))
const createTaskWithEffects = mock(async () => ({ id: 'task-doctor-repair' }))
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
mock.module('../../src/core/task-service', () => ({ createTaskWithEffects }))
mock.module('../../src/core/dispatch', () => ({ dispatchSingleTask }))
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { agents: { list: async () => [{ id: 'main' }] } } }) }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => ({ runtime: { agents: { list: async () => [{ id: 'main' }] } } }) }))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))

import { delegateDoctorRepair } from '../../src/core/doctor-delegate'
import { getDoctorRepairRequest, listDoctorRepairRequests } from '../../src/core/doctor-repair-store'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  createTaskWithEffects.mockClear()
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
})
