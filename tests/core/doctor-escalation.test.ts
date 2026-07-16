import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import type { HealthIncident, HealthReport } from '@makinbakin/sdk/types'

let mode: 'off' | 'notify' | 'task' = 'task'
let cooldownMs = 6 * 60 * 60_000
let staleAfterMs = 12 * 60 * 60_000
let requests: Array<{
  id: string
  incidentIds: string[]
  taskId?: string
  createdAt: string
}> = []
let taskColumns: Record<string, string> = {}

const send = mock(async (_input: { agentId: string; content: string }) => ({ id: 'message-1' }))
const delegate = mock(async () => ({ status: 'sent' }))

mock.module('../../src/core/settings', () => ({
  getSettings: () => ({
    doctor: {
      escalation: mode,
      escalationCooldownMs: cooldownMs,
      escalationStaleAfterMs: staleAfterMs,
    },
  }),
}))
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({ runtime: { messaging: { send } } }),
}))
mock.module('../../src/core/agent-cost', () => ({ meterAgentTurn: async () => {} }))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))
mock.module('../../src/core/doctor-repair-store', () => ({ listDoctorRepairRequests: () => requests }))
mock.module('../../src/core/task-service', () => ({
  getTaskDetails: async (taskId: string) => taskId in taskColumns ? { column: taskColumns[taskId] } : null,
}))
mock.module('../../src/core/doctor-delegate', () => ({ delegateDoctorRepair: delegate }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

import {
  clearNotifiedIssues,
  escalateCronIncidents,
  freshActionRequiredIncidents,
  notifyActionRequiredIncidents,
} from '../../src/core/doctor-escalation'

function incident(overrides: Partial<HealthIncident> = {}): HealthIncident {
  return {
    id: 'health:search:unavailable',
    status: 'error',
    disposition: 'action_required',
    title: 'Search is unavailable',
    impact: 'Search requests fail.',
    resources: [],
    resolution: { key: 'review', type: 'navigate', label: 'Review', href: '/health?tab=system' },
    observationIds: ['health.search:engine'],
    observedAt: '2026-07-13T12:00:00.000Z',
    staleAt: '2026-07-13T12:10:00.000Z',
    stale: false,
    ...overrides,
  }
}

function report(incidents: HealthIncident[]): HealthReport {
  return {
    id: 'health-report-1',
    revision: 1,
    generatedAt: '2026-07-13T12:00:00.000Z',
    overallStatus: 'needs_attention',
    lastFullSweep: null,
    checks: [],
    observations: [],
    incidents,
    subsystems: {
      search: {
        status: 'unknown',
        summary: 'Unknown.',
        observedAt: null,
        staleAt: null,
        stages: [],
        incidentIds: [],
      },
    },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: incidents.length, watching: 0, advisory: 0, unknown: 0 },
    },
  }
}

function coveringRequest(
  ageMs: number,
  overrides: Partial<(typeof requests)[number]> = {},
): (typeof requests)[number] {
  return {
    id: 'repair-1',
    incidentIds: ['health:search:unavailable'],
    taskId: 'task-1',
    createdAt: new Date(Date.now() - ageMs).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  mode = 'task'
  cooldownMs = 6 * 60 * 60_000
  staleAfterMs = 12 * 60 * 60_000
  requests = []
  taskColumns = {}
  send.mockClear()
  delegate.mockClear()
  clearNotifiedIssues()
  setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
})

afterEach(() => {
  setSystemTime()
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
    await notifyActionRequiredIncidents(report([incident()]))
    await notifyActionRequiredIncidents(report([incident({ title: 'Copy changed' })]))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].content).toContain('health:search:unavailable')
  })

  it('retries an incident when the previous notification could not be delivered', async () => {
    send.mockImplementationOnce(async () => { throw new Error('runtime unavailable') })

    await notifyActionRequiredIncidents(report([incident()]))
    await notifyActionRequiredIncidents(report([incident()]))

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent notification attempts for the same incident', async () => {
    let releaseSend!: () => void
    send.mockImplementationOnce(() => new Promise<{ id: string }>((resolve) => {
      releaseSend = () => resolve({ id: 'message-1' })
    }))

    const first = notifyActionRequiredIncidents(report([incident()]))
    const second = notifyActionRequiredIncidents(report([incident()]))
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)

    releaseSend()
    await Promise.all([first, second])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('allows the same incident to notify again after the configured cooldown', async () => {
    cooldownMs = 60_000
    await notifyActionRequiredIncidents(report([incident()]))

    setSystemTime(new Date('2026-07-15T12:00:59.999Z'))
    await notifyActionRequiredIncidents(report([incident()]))
    expect(send).toHaveBeenCalledTimes(1)

    setSystemTime(new Date('2026-07-15T12:01:00.000Z'))
    await notifyActionRequiredIncidents(report([incident()]))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('delegates exact fresh incidents in task mode', async () => {
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      accepted: true,
      target: { type: 'incidents', reportId: 'health-report-1', ids: ['health:search:unavailable'] },
    }))
  })

  it('skips while a fresh open repair task covers every current incident', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'doing' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).not.toHaveBeenCalled()
  })

  it('treats an archived covering task as closed once cooldown has passed', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'archived' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('re-escalates when a covering open task is stale and incidents are still burning', async () => {
    requests = [coveringRequest(34 * 60 * 60_000)]
    taskColumns = { 'task-1': 'doing' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('still honors the task cooldown when a custom stale threshold is shorter', async () => {
    staleAfterMs = 60 * 60_000
    requests = [coveringRequest(2 * 60 * 60_000)]
    taskColumns = { 'task-1': 'doing' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).not.toHaveBeenCalled()
  })

  it('lets a newer fresh covering request suppress an older stale one', async () => {
    requests = [
      coveringRequest(34 * 60 * 60_000, { id: 'repair-old', taskId: 'task-old' }),
      coveringRequest(60_000, { id: 'repair-new', taskId: 'task-new' }),
    ]
    taskColumns = { 'task-old': 'doing', 'task-new': 'todo' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window even when the previous task is done', async () => {
    requests = [coveringRequest(60_000)]
    taskColumns = { 'task-1': 'done' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).not.toHaveBeenCalled()
  })

  it('delegates after cooldown when the previous task is done', async () => {
    requests = [coveringRequest(7 * 60 * 60_000)]
    taskColumns = { 'task-1': 'done' }

    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')

    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('does not treat a request covering only some current incidents as a cover', async () => {
    requests = [coveringRequest(60_000)]
    taskColumns = { 'task-1': 'doing' }

    await escalateCronIncidents(report([
      incident(),
      incident({ id: 'health:runtime:unavailable' }),
    ]), '/tmp/content', '/tmp/project')

    expect(delegate).toHaveBeenCalledTimes(1)
  })

  it('contains delegation failures so cron diagnostics still complete', async () => {
    delegate.mockImplementationOnce(async () => { throw new Error('delegate unavailable') })

    await expect(escalateCronIncidents(
      report([incident()]),
      '/tmp/content',
      '/tmp/project',
    )).resolves.toBeUndefined()
  })

  it('notifies instead of delegating in notify mode and skips onboarding-only state', async () => {
    mode = 'notify'
    await escalateCronIncidents(report([incident()]), '/tmp/content', '/tmp/project')
    expect(send).toHaveBeenCalledTimes(1)
    expect(delegate).not.toHaveBeenCalled()

    send.mockClear()
    await escalateCronIncidents(
      report([incident({ id: 'core:system:onboarding-required' })]),
      '/tmp/content',
      '/tmp/project',
    )
    expect(send).not.toHaveBeenCalled()
  })
})
