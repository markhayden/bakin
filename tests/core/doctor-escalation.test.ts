import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { HealthIncident, HealthReport } from '@makinbakin/sdk/types'

let mode: 'off' | 'notify' | 'task' = 'task'
let requests: any[] = []
let taskColumn: string | null = null
const send = mock(async (_input: { agentId: string; content: string }) => ({ id: 'message-1' }))
const delegate = mock(async () => ({ status: 'sent' }))

mock.module('../../src/core/settings', () => ({ getSettings: () => ({ doctor: { escalation: mode, escalationCooldownMs: 60_000 } }) }))
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send } } }) }))
mock.module('../../src/core/agent-cost', () => ({ meterAgentTurn: async () => {} }))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))
mock.module('../../src/core/doctor-repair-store', () => ({ listDoctorRepairRequests: () => requests }))
mock.module('../../src/core/task-service', () => ({ getTaskDetails: async () => taskColumn ? { column: taskColumn } : null }))
mock.module('../../src/core/doctor-delegate', () => ({ delegateDoctorRepair: delegate }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import {
  clearNotifiedIssues,
  escalateCronIncidents,
  freshActionRequiredIncidents,
  notifyActionRequiredIncidents,
} from '../../src/core/doctor-escalation'

function incident(overrides: Partial<HealthIncident> = {}): HealthIncident {
  return {
    id: 'health:search:unavailable', status: 'error', disposition: 'action_required',
    title: 'Search is unavailable', impact: 'Search requests fail.', resources: [],
    resolution: { key: 'review', type: 'navigate', label: 'Review', href: '/health?tab=system' },
    observationIds: ['health.search:engine'], observedAt: '2026-07-13T12:00:00.000Z', staleAt: '2026-07-13T12:10:00.000Z', stale: false,
    ...overrides,
  }
}

function report(incidents: HealthIncident[]): HealthReport {
  return {
    id: 'health-report-1', revision: 1, generatedAt: '2026-07-13T12:00:00.000Z', overallStatus: 'needs_attention', lastFullSweep: null,
    checks: [], observations: [], incidents,
    subsystems: { search: { status: 'unknown', summary: 'Unknown.', observedAt: null, staleAt: null, stages: [], incidentIds: [] } },
    summary: { checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 }, incidents: { actionRequired: incidents.length, watching: 0, advisory: 0, unknown: 0 } },
  }
}

beforeEach(() => {
  mode = 'task'
  requests = []
  taskColumn = null
  send.mockClear()
  delegate.mockClear()
  clearNotifiedIssues()
})

describe('canonical Health escalation', () => {
  it('selects only fresh action-required incident IDs', () => {
    expect(freshActionRequiredIncidents(report([
      incident(),
      incident({ id: 'stale', stale: true }),
      incident({ id: 'watch', disposition: 'watch', status: 'warning' }),
    ])).map((row) => row.id)).toEqual(['health:search:unavailable'])
  })

  it('deduplicates notifications by incident ID, not message copy', async () => {
    const first = report([incident()])
    await notifyActionRequiredIncidents(first)
    await notifyActionRequiredIncidents(report([incident({ title: 'Copy changed' })]))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].content).toContain('health:search:unavailable')
  })

  it('delegates exact fresh incidents in task mode', async () => {
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      accepted: true,
      target: { type: 'incidents', reportId: 'health-report-1', ids: ['health:search:unavailable'] },
    }))
  })

  it('skips an open covering request or a recent completed request', async () => {
    requests = [{ incidentIds: ['health:search:unavailable'], taskId: 'task-1', createdAt: new Date().toISOString() }]
    taskColumn = 'doing'
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')
    taskColumn = 'done'
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')
    expect(delegate).not.toHaveBeenCalled()
  })

  it('notifies instead of delegating in notify mode and skips onboarding-only state', async () => {
    mode = 'notify'
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')
    expect(send).toHaveBeenCalledTimes(1)
    expect(delegate).not.toHaveBeenCalled()
    send.mockClear()
    await escalateCronIncidents(report([incident({ id: 'core:system:onboarding-required' })]), '/tmp/content', '/tmp/project')
    expect(send).not.toHaveBeenCalled()
  })
})
