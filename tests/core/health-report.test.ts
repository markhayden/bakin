import { describe, expect, it } from 'bun:test'
import type { HealthCheckState, HealthObservation } from '@makinbakin/sdk/types'
import {
  buildHealthIncidents,
  deriveHealthReportStatus,
  HealthIncidentConflictError,
} from '../../src/core/health-report'

const now = '2026-07-13T12:00:00.000Z'

function observation(overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: 'health.search:engine',
    key: 'engine',
    status: 'warning',
    summary: 'Search is rebuilding.',
    checkId: 'health.search',
    checkName: 'Search live readiness',
    owner: { kind: 'plugin', id: 'health', label: 'Health' },
    group: { key: 'search', label: 'Search' },
    checkedAt: '2026-07-13T11:55:00.000Z',
    observedAt: '2026-07-13T11:55:00.000Z',
    staleAt: '2026-07-13T12:30:00.000Z',
    snapshot: 'current',
    incidentId: 'health:search:rebuilding',
    incident: {
      key: 'rebuilding',
      title: 'Search is rebuilding',
      impact: 'Some results may be incomplete.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search', label: 'Search' }],
      resolution: { key: 'review', type: 'navigate', label: 'Review Search', href: '/health?tab=system' },
    },
    ...overrides,
  } as HealthObservation
}

function state(outcome: HealthCheckState['latestExecution']['outcome'] = 'observed'): HealthCheckState {
  return {
    checkId: 'health.search',
    checkName: 'Search live readiness',
    description: 'Checks the live Search engine, indexes, and journal.',
    owner: { kind: 'plugin', id: 'health', label: 'Health' },
    group: { key: 'search', label: 'Search' },
    latestExecution: {
      id: 'execution-1',
      checkId: 'health.search',
      startedAt: '2026-07-13T11:55:00.000Z',
      completedAt: '2026-07-13T11:55:01.000Z',
      outcome,
    },
  }
}

describe('canonical incident projection', () => {
  it('merges only an explicit owner-scoped id and keeps the oldest evidence', () => {
    const incidents = buildHealthIncidents([
      observation(),
      observation({
        id: 'health.search-consistency:indexes',
        checkId: 'health.search-consistency',
        key: 'indexes',
        status: 'error',
        observedAt: '2026-07-13T11:50:00.000Z',
        staleAt: '2026-07-13T12:20:00.000Z',
        incident: {
          ...observation().incident!,
          disposition: 'action_required',
          resources: [{ kind: 'search_table', id: 'tasks', label: 'Tasks' }],
        },
      }),
    ], now)

    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      id: 'health:search:rebuilding',
      status: 'error',
      disposition: 'action_required',
      observedAt: '2026-07-13T11:50:00.000Z',
      staleAt: '2026-07-13T12:20:00.000Z',
      stale: false,
      observationIds: ['health.search-consistency:indexes', 'health.search:engine'],
    })
    expect(incidents[0].resources).toEqual([
      { kind: 'search_table', id: 'tasks', label: 'Tasks' },
      { kind: 'service', id: 'search', label: 'Search' },
    ])
  })

  it('rejects copy or resolution conflicts instead of using first arrival', () => {
    expect(() => buildHealthIncidents([
      observation(),
      observation({ id: 'health.search:second', incident: { ...observation().incident!, title: 'Different title' } }),
    ], now)).toThrow(HealthIncidentConflictError)
  })

  it('marks an incident stale at the earliest member expiry', () => {
    const [incident] = buildHealthIncidents([
      observation({ staleAt: '2026-07-13T11:59:59.000Z' }),
    ], now)
    expect(incident.stale).toBe(true)
  })
})

describe('overall health precedence', () => {
  const watch = buildHealthIncidents([observation()], now)
  const action = buildHealthIncidents([observation({
    status: 'error',
    incident: { ...observation().incident!, disposition: 'action_required' },
  })], now)

  it('places action-required above unknown/stale', () => {
    expect(deriveHealthReportStatus({
      registeredChecks: 1,
      checks: [state('failed')],
      incidents: action,
    })).toBe('needs_attention')
  })

  it('requires every registration and a valid latest execution before Healthy', () => {
    expect(deriveHealthReportStatus({ registeredChecks: 2, checks: [state()], incidents: [] })).toBe('unknown_stale')
    expect(deriveHealthReportStatus({ registeredChecks: 1, checks: [state('invalid')], incidents: [] })).toBe('unknown_stale')
  })

  it('distinguishes watch from advisory-only health', () => {
    expect(deriveHealthReportStatus({ registeredChecks: 1, checks: [state()], incidents: watch })).toBe('degraded')
    expect(deriveHealthReportStatus({
      registeredChecks: 1,
      checks: [state()],
      incidents: [{ ...watch[0], disposition: 'advisory' }],
    })).toBe('healthy')
  })
})
