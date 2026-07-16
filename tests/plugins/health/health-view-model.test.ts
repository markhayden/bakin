import { describe, expect, it } from 'bun:test'
import type {
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  HealthReport,
  SearchReadiness,
} from '@makinbakin/sdk/types'
import type { HealthSummary, LiveNowData } from '../../../plugins/health/types'
import { buildHealthOverviewViewModel } from '../../../plugins/health/lib/health-view-model'

const NOW = Date.parse('2026-07-13T12:00:00.000Z')
const FRESH_AT = '2026-07-13T13:00:00.000Z'

function incident(overrides: Partial<HealthIncident> & Pick<HealthIncident, 'id'>): HealthIncident {
  const { id, ...rest } = overrides
  return {
    id,
    status: 'warning',
    disposition: 'watch',
    title: id,
    impact: 'Operator impact.',
    resources: [],
    resolution: { key: 'again', type: 'rerun', label: 'Check again' },
    observationIds: [`observation:${id}`],
    observedAt: '2026-07-13T11:00:00.000Z',
    staleAt: FRESH_AT,
    stale: false,
    ...rest,
  }
}

function observation(source: HealthIncident, overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: source.observationIds[0]!,
    key: source.id,
    status: source.status,
    summary: source.title,
    checkId: `check:${source.id}`,
    checkName: source.title,
    owner: { kind: 'core', id: 'core', label: 'Bakin' },
    group: { key: 'runtime', label: 'Runtime' },
    checkedAt: source.observedAt,
    observedAt: source.observedAt,
    staleAt: source.staleAt,
    snapshot: source.stale ? 'last_known' : 'current',
    incidentId: source.id,
    incident: {
      key: source.id,
      title: source.title,
      impact: source.impact,
      disposition: source.disposition,
      resources: source.resources,
      resolution: source.resolution,
    },
    ...overrides,
  } as HealthObservation
}

function check(source: HealthObservation, outcome: HealthCheckState['latestExecution']['outcome'] = 'observed'): HealthCheckState {
  return {
    checkId: source.checkId,
    checkName: source.checkName,
    description: `Checks ${source.checkName}.`,
    owner: source.owner,
    group: source.group,
    latestExecution: {
      id: `execution:${source.id}`,
      checkId: source.checkId,
      startedAt: source.checkedAt,
      completedAt: source.checkedAt,
      outcome,
      ...(outcome === 'failed' ? { error: { code: 'FAILED', message: 'Probe failed.' } } : {}),
    },
    ...(outcome === 'observed' ? { latestValidSnapshot: { executionId: `execution:${source.id}`, observations: [source] } } : {}),
  }
}

function search(overrides: Partial<SearchReadiness> = {}): SearchReadiness {
  return {
    status: 'healthy',
    summary: 'Search is ready.',
    observedAt: '2026-07-13T11:55:00.000Z',
    staleAt: FRESH_AT,
    incidentIds: [],
    stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
      key,
      label: key[0]!.toUpperCase() + key.slice(1),
      status: 'healthy' as const,
      summary: `${key} is ready.`,
      observedAt: '2026-07-13T11:55:00.000Z',
      staleAt: FRESH_AT,
      observationIds: [],
    })),
    ...overrides,
  }
}

function report(options: {
  incidents?: HealthIncident[]
  observations?: HealthObservation[]
  checks?: HealthCheckState[]
  search?: SearchReadiness
  status?: HealthReport['overallStatus']
} = {}): HealthReport {
  const incidents = options.incidents ?? []
  const observations = options.observations ?? []
  const checks = options.checks ?? observations.map((row) => check(row))
  return {
    id: 'report-1', revision: 1, generatedAt: '2026-07-13T12:00:00.000Z',
    overallStatus: options.status ?? (incidents.length > 0 ? 'degraded' : 'healthy'),
    lastFullSweep: { id: 'sweep-1', startedAt: '2026-07-13T11:59:00.000Z', completedAt: '2026-07-13T12:00:00.000Z' },
    checks, observations, incidents,
    subsystems: { search: options.search ?? search() },
    summary: {
      checks: {
        registered: checks.length,
        completed: checks.filter((row) => row.latestExecution.outcome === 'observed').length,
        failed: checks.filter((row) => row.latestExecution.outcome === 'failed').length,
        invalid: checks.filter((row) => row.latestExecution.outcome === 'invalid').length,
        notApplicable: checks.filter((row) => row.latestExecution.outcome === 'not_applicable').length,
      },
      incidents: {
        actionRequired: incidents.filter((row) => row.disposition === 'action_required').length,
        watching: incidents.filter((row) => row.disposition === 'watch').length,
        advisory: incidents.filter((row) => row.disposition === 'advisory').length,
        unknown: incidents.filter((row) => row.status === 'unknown').length,
      },
    },
  }
}

describe('buildHealthOverviewViewModel', () => {
  it('places and deterministically sorts action, unverifiable, and watch incidents', () => {
    const actionWarning = incident({
      id: 'action-warning', status: 'warning', disposition: 'action_required', title: 'Warning action',
      stale: true, staleAt: '2026-07-13T11:30:00.000Z',
    })
    const actionError = incident({
      id: 'action-error', status: 'error', disposition: 'action_required', title: 'Error action',
    })
    const staleWatch = incident({
      id: 'stale-watch', status: 'warning', disposition: 'watch', title: 'Stale watch',
      stale: true, staleAt: '2026-07-13T11:30:00.000Z', observedAt: '2026-07-13T09:00:00.000Z',
    })
    const failed = incident({ id: 'failed-check', status: 'unknown', disposition: 'watch', title: 'Failed check' })
    const freshUnknown = incident({
      id: 'fresh-unknown', status: 'unknown', disposition: 'watch', title: 'Fresh unknown',
      observedAt: '2026-07-13T08:00:00.000Z',
    })
    const watchZulu = incident({ id: 'watch-zulu', status: 'warning', disposition: 'watch', title: 'Zulu warning' })
    const watchAlpha = incident({ id: 'watch-alpha', status: 'warning', disposition: 'watch', title: 'Alpha warning' })
    const advisory = incident({ id: 'advisory', status: 'warning', disposition: 'advisory', title: 'Advisory only' })
    const incidents = [watchZulu, staleWatch, actionWarning, advisory, freshUnknown, failed, watchAlpha, actionError]
    const observations = incidents.map((row) => observation(row))
    const checks = observations.map((row) => check(row, row.incidentId === failed.id ? 'failed' : 'observed'))

    const model = buildHealthOverviewViewModel({
      report: report({ incidents, observations, checks, status: 'needs_attention' }),
      now: NOW,
    })

    expect(model.needsAction.map((row) => row.incident.id)).toEqual(['action-error', 'action-warning'])
    expect(model.unableToVerify.map((row) => row.incident.id)).toEqual(['failed-check', 'fresh-unknown', 'stale-watch'])
    expect(model.watching.map((row) => row.incident.id)).toEqual(['watch-alpha', 'watch-zulu'])
    expect([
      ...model.needsAction, ...model.unableToVerify, ...model.watching,
    ].some((row) => row.incident.id === advisory.id)).toBe(false)
    expect(model.needsAction[1]?.freshness).toBe('stale')
  })

  it('always returns the four labeled Search stages and explains missing or stale evidence', () => {
    const readiness = search({
      status: 'unknown',
      summary: 'Search readiness is incomplete.',
      stages: [
        {
          key: 'engine', label: 'Engine', status: 'healthy', summary: 'Engine is reachable.',
          observedAt: '2026-07-13T11:00:00.000Z', staleAt: '2026-07-13T11:30:00.000Z', observationIds: [],
        },
        {
          key: 'queries', label: 'Queries', status: 'unhealthy', summary: 'Production queries are failing.',
          observedAt: '2026-07-13T11:55:00.000Z', staleAt: FRESH_AT, observationIds: ['search:queries'],
        },
      ],
    })

    const model = buildHealthOverviewViewModel({ report: report({ search: readiness, status: 'unknown_stale' }), now: NOW })

    expect(model.search.stages.map((stage) => stage.label)).toEqual(['Engine', 'Queries', 'Indexes', 'Journal'])
    expect(model.search.stages.map((stage) => stage.status)).toEqual(['unknown', 'unhealthy', 'unknown', 'unknown'])
    expect(model.search.stages[0]?.summary).toContain('stale')
    expect(model.search.stages[1]?.summary).toBe('Production queries are failing.')
    expect(model.search.stages[2]?.summary).toContain('No current Indexes evidence')
    expect(model.healthy).toBe(false)
  })

  it('derives Right now from live facts and only claims healthy for fresh verified evidence', () => {
    const summary: HealthSummary = {
      errors1h: { total: 4, byKind: { mcp: 1, rest: 2, agent: 1 } },
      activeSessions: [
        { agent: 'one', sessions: 2, connectedAt: '2026-07-13T11:00:00.000Z' },
        { agent: 'two', sessions: 3, connectedAt: '2026-07-13T11:30:00.000Z' },
      ],
      upSince: '2026-07-12T12:00:00.000Z',
      server: null,
    }
    const liveNow: LiveNowData = {
      generatedAt: '2026-07-13T11:59:59.000Z',
      runs: [
        { agent: 'one', taskId: 'task-1', taskTitle: 'First', runId: 'run-1', startedAt: NOW - 30_000, runningForMs: 30_000, heartbeatAgeMs: 1_000 },
        { agent: 'two', taskId: 'task-2', taskTitle: 'Second', runId: 'run-2', startedAt: NOW - 60_000, runningForMs: 60_000, heartbeatAgeMs: 2_000 },
      ],
    }

    const model = buildHealthOverviewViewModel({ report: report(), summary, liveNow, now: NOW })

    expect(model.rightNow).toMatchObject({ runningDispatches: 2, connectedSessions: 5, recentFailures: 4 })
    expect(model.healthy).toBe(true)

    const expired = report()
    expired.subsystems.search.staleAt = '2026-07-13T11:00:00.000Z'
    expect(buildHealthOverviewViewModel({ report: expired, now: NOW }).healthy).toBe(false)

    const missingExpiry = report()
    missingExpiry.subsystems.search.staleAt = null
    expect(buildHealthOverviewViewModel({ report: missingExpiry, now: NOW }).search.status).toBe('unknown')
  })
})
