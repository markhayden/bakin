import { describe, expect, it } from 'bun:test'
import type { HealthCheckState, HealthIncident, HealthObservation } from '@makinbakin/sdk/types'
import { deriveSearchReadiness } from '../../src/core/health-search-readiness'

const generatedAt = '2026-07-13T12:00:00.000Z'

function observation(key: 'engine' | 'queries' | 'indexes' | 'journal', overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: `health.search:${key}`,
    key,
    status: 'healthy',
    summary: `${key} is ready`,
    checkId: 'health.search',
    checkName: 'Search readiness',
    owner: { kind: 'plugin', id: 'health', label: 'Health' },
    group: { key: 'search', label: 'Search' },
    checkedAt: '2026-07-13T11:55:00.000Z',
    observedAt: '2026-07-13T11:55:00.000Z',
    staleAt: '2026-07-13T12:30:00.000Z',
    snapshot: 'current',
    ...overrides,
  } as HealthObservation
}

function incident(overrides: Partial<HealthIncident> = {}): HealthIncident {
  return {
    id: 'health:search:queries-dark',
    status: 'error',
    disposition: 'action_required',
    title: 'Search queries are failing',
    impact: 'Users cannot find indexed content.',
    resources: [{ kind: 'service', id: 'search' }],
    resolution: { key: 'review', type: 'navigate', label: 'Review Search', href: '/health?tab=system' },
    observationIds: ['health.search:queries'],
    observedAt: '2026-07-13T11:55:00.000Z',
    staleAt: '2026-07-13T12:30:00.000Z',
    stale: false,
    ...overrides,
  }
}

function searchCheck(overrides: Partial<HealthCheckState> = {}): HealthCheckState {
  return {
    checkId: 'health.search-canary',
    checkName: 'Search canary',
    description: 'Checks a real query.',
    owner: { kind: 'plugin', id: 'health', label: 'Health' },
    group: { key: 'search', label: 'Search' },
    latestExecution: {
      id: 'execution-failed',
      checkId: 'health.search-canary',
      startedAt: generatedAt,
      completedAt: generatedAt,
      outcome: 'failed',
      error: { code: 'HEALTH_CHECK_FAILED', message: 'timeout' },
    },
    ...overrides,
  }
}

describe('Search readiness classifier', () => {
  const healthy = () => [observation('engine'), observation('queries'), observation('indexes'), observation('journal')]

  it('requires every stage and reports exact stage order', () => {
    const readiness = deriveSearchReadiness({ observations: healthy(), incidents: [], generatedAt })
    expect(readiness.status).toBe('healthy')
    expect(readiness.stages.map((stage) => stage.key)).toEqual(['engine', 'queries', 'indexes', 'journal'])

    expect(deriveSearchReadiness({
      observations: healthy().filter((row) => row.key !== 'queries'),
      incidents: [],
      generatedAt,
    }).status).toBe('unknown')
  })

  it('gives a fresh unhealthy stage precedence over missing evidence', () => {
    const issue = incident()
    const readiness = deriveSearchReadiness({
      observations: [
        observation('engine'),
        observation('queries', { status: 'error', incidentId: issue.id }),
      ],
      incidents: [issue],
      generatedAt,
    })
    expect(readiness.status).toBe('unhealthy')
    expect(readiness.incidentIds).toEqual([issue.id])
  })

  it('treats stale, unknown, and unexplained non-healthy evidence as unknown', () => {
    for (const row of [
      observation('queries', { staleAt: '2026-07-13T11:59:00.000Z' }),
      observation('queries', { status: 'unknown' }),
      observation('queries', { status: 'warning' }),
    ]) {
      const rows = healthy().map((candidate) => candidate.key === 'queries' ? row : candidate)
      expect(deriveSearchReadiness({ observations: rows, incidents: [], generatedAt }).status).toBe('unknown')
    }
  })

  it('classifies an explained fresh warning as degraded', () => {
    const watch = incident({ id: 'health:search:queries-slow', status: 'warning', disposition: 'watch' })
    const rows = healthy().map((row) => row.key === 'queries'
      ? observation('queries', { status: 'warning', incidentId: watch.id })
      : row)
    expect(deriveSearchReadiness({ observations: rows, incidents: [watch], generatedAt }).status).toBe('degraded')
  })

  it('uses a failed check verification incident to explain its required stage', () => {
    const verificationIncident = incident({
      id: 'core:verification:health.search-canary',
      status: 'unknown',
      disposition: 'watch',
      title: 'Search canary could not be verified',
      observationIds: ['health.search-canary:verification'],
    })
    const verification = observation('queries', {
      id: 'health.search-canary:verification',
      key: 'verification',
      checkId: 'health.search-canary',
      checkName: 'Search canary',
      group: { key: 'verification', label: 'Verification' },
      owner: { kind: 'core', id: 'core', label: 'Bakin' },
      status: 'unknown',
      incidentId: verificationIncident.id,
      incident: {
        key: 'health.search-canary',
        title: verificationIncident.title,
        impact: verificationIncident.impact,
        disposition: 'watch',
        resources: verificationIncident.resources,
        resolution: verificationIncident.resolution,
      },
    })
    const readiness = deriveSearchReadiness({
      observations: [...healthy(), verification],
      incidents: [verificationIncident],
      checks: [searchCheck()],
      generatedAt,
    })

    expect(readiness.status).toBe('unknown')
    expect(readiness.stages.find((stage) => stage.key === 'queries')?.observationIds)
      .toContain(verification.id)
    expect(readiness.incidentIds).toContain(verificationIncident.id)
  })

  it('maps a failed live Search composite to Engine, Indexes, and Journal', () => {
    const verificationIncident = incident({
      id: 'core:verification:health.search',
      status: 'unknown',
      disposition: 'watch',
      title: 'Search live composite could not be verified',
      observationIds: ['health.search:verification'],
    })
    const verification = observation('engine', {
      id: 'health.search:verification',
      key: 'verification',
      checkId: 'health.search',
      group: { key: 'verification', label: 'Verification' },
      owner: { kind: 'core', id: 'core', label: 'Bakin' },
      status: 'unknown',
      incidentId: verificationIncident.id,
      incident: {
        key: 'health.search',
        title: verificationIncident.title,
        impact: verificationIncident.impact,
        disposition: 'watch',
        resources: verificationIncident.resources,
        resolution: verificationIncident.resolution,
      },
    })
    const failedComposite = searchCheck({
      checkId: 'health.search',
      latestExecution: {
        id: 'execution-failed',
        checkId: 'health.search',
        startedAt: generatedAt,
        completedAt: generatedAt,
        outcome: 'failed',
        error: { code: 'HEALTH_CHECK_FAILED', message: 'timeout' },
      },
    })

    const readiness = deriveSearchReadiness({
      observations: [verification],
      incidents: [verificationIncident],
      checks: [failedComposite],
      generatedAt,
    })

    for (const key of ['engine', 'indexes', 'journal'] as const) {
      expect(readiness.stages.find((stage) => stage.key === key)?.observationIds).toContain(verification.id)
    }
  })

  it('does not treat a stale not-applicable Search check as healthy', () => {
    const verificationIncident = incident({
      id: 'core:verification:stale:health.search-canary',
      status: 'unknown',
      disposition: 'watch',
      title: 'Search canary evidence is stale',
      observationIds: ['health.search-canary:verification.stale'],
    })
    const verification = observation('queries', {
      id: 'health.search-canary:verification.stale',
      key: 'verification.stale',
      checkId: 'health.search-canary',
      checkName: 'Search canary',
      group: { key: 'verification', label: 'Verification' },
      owner: { kind: 'core', id: 'core', label: 'Bakin' },
      status: 'unknown',
      incidentId: verificationIncident.id,
      incident: {
        key: 'stale:health.search-canary',
        title: verificationIncident.title,
        impact: verificationIncident.impact,
        disposition: 'watch',
        resources: verificationIncident.resources,
        resolution: verificationIncident.resolution,
      },
    })
    const notApplicable = searchCheck({
      latestExecution: {
        id: 'execution-na',
        checkId: 'health.search-canary',
        startedAt: generatedAt,
        completedAt: generatedAt,
        outcome: 'not_applicable',
        reason: 'Search is disabled.',
      },
    })

    const readiness = deriveSearchReadiness({
      observations: [verification],
      incidents: [verificationIncident],
      checks: [notApplicable],
      generatedAt,
    })

    expect(readiness.status).toBe('unknown')
    expect(readiness.stages.find((stage) => stage.key === 'queries')?.observationIds)
      .toContain(verification.id)
  })

  it('never treats last-known healthy Search evidence as current healthy evidence', () => {
    const rows = healthy().map((row) => row.key === 'queries'
      ? observation('queries', { snapshot: 'last_known' })
      : row)
    expect(deriveSearchReadiness({ observations: rows, incidents: [], generatedAt }).status).toBe('unknown')
  })
})
