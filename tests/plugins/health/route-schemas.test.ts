import { describe, expect, it } from 'bun:test'
import {
  canonicalHealthIncidentSchema,
  canonicalHealthObservationSchema,
  healthReportSchema,
} from '../../../plugins/health/lib/route-schemas'

const observedAt = '2026-07-13T20:00:00.000Z'
const observationBase = {
  id: 'health.search:engine.availability',
  key: 'engine.availability',
  summary: 'Search engine is unavailable.',
  checkId: 'health.search',
  checkName: 'Search',
  owner: { kind: 'plugin' as const, id: 'health', label: 'Health' },
  group: { key: 'search', label: 'Search' },
  checkedAt: observedAt,
  observedAt,
  staleAt: '2026-07-13T20:01:00.000Z',
  snapshot: 'current' as const,
  incidentId: 'health:search:unavailable',
}

const incidentBase = {
  key: 'search.unavailable',
  title: 'Search is unavailable',
  impact: 'Search-backed discovery is unavailable.',
  resolution: { key: 'restart-search', type: 'rerun' as const, label: 'Rerun Search checks' },
}

describe('canonical Health HTTP observation schema', () => {
  it('rejects an Error observation with a non-actionable incident', () => {
    const result = canonicalHealthObservationSchema.safeParse({
      ...observationBase,
      status: 'error',
      incident: { ...incidentBase, disposition: 'watch' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects an Unknown observation with an actionable incident', () => {
    const result = canonicalHealthObservationSchema.safeParse({
      ...observationBase,
      status: 'unknown',
      incident: { ...incidentBase, disposition: 'action_required' },
    })

    expect(result.success).toBe(false)
  })

  it('accepts an ADVISORY Unknown observation — the wire mirror must not lag the producer contract', () => {
    // This mirror lagging the contract made the CLIENT reject the whole
    // health report the first time a server emitted an advisory unknown:
    // "Health report response was invalid" on a healthy box (rc.24 field
    // report, 2026-07-23).
    const result = canonicalHealthObservationSchema.safeParse({
      ...observationBase,
      status: 'unknown',
      incident: { ...incidentBase, disposition: 'advisory' },
    })

    expect(result.success).toBe(true)
  })
})

function canonicalReport() {
  const incident = {
    key: 'search.degraded',
    title: 'Search is degraded',
    impact: 'Some search results may be delayed.',
    disposition: 'watch' as const,
    resources: [{ kind: 'service' as const, id: 'search', label: 'Search' }],
    resolution: { key: 'rerun-search', type: 'rerun' as const, label: 'Check again' },
  }

  return {
    id: 'health-report-1',
    revision: 1,
    generatedAt: observedAt,
    overallStatus: 'degraded' as const,
    sensitivity: 'standard' as const,
    lastFullSweep: { id: 'sweep-1', startedAt: observedAt, completedAt: observedAt },
    checks: [{
      checkId: 'health.search',
      checkName: 'Search',
      description: 'Checks Search readiness.',
      owner: { kind: 'plugin' as const, id: 'health', label: 'Health' },
      group: { key: 'search', label: 'Search' },
      latestExecution: {
        id: 'execution-1',
        checkId: 'health.search',
        startedAt: observedAt,
        completedAt: observedAt,
        outcome: 'observed' as const,
      },
    }],
    observations: [{
      id: 'health.search:availability',
      key: 'availability',
      summary: 'Search is degraded.',
      checkId: 'health.search',
      checkName: 'Search',
      owner: { kind: 'plugin' as const, id: 'health', label: 'Health' },
      group: { key: 'search', label: 'Search' },
      checkedAt: observedAt,
      observedAt,
      staleAt: '2026-07-13T20:01:00.000Z',
      snapshot: 'current' as const,
      status: 'warning' as const,
      incidentId: 'health:search:degraded',
      incident,
    }],
    incidents: [{
      id: 'health:search:degraded',
      status: 'warning' as const,
      disposition: 'watch' as const,
      effectiveDisposition: 'watch' as const,
      title: incident.title,
      impact: incident.impact,
      resources: incident.resources,
      resolution: incident.resolution,
      observationIds: ['health.search:availability'],
      observedAt,
      staleAt: '2026-07-13T20:01:00.000Z',
      stale: false,
    }],
    subsystems: {
      search: {
        status: 'degraded' as const,
        summary: 'Search is degraded.',
        observedAt,
        staleAt: '2026-07-13T20:01:00.000Z',
        stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
          key,
          label: key,
          status: key === 'engine' ? 'degraded' as const : 'healthy' as const,
          summary: `${key} status is known.`,
          observedAt,
          staleAt: '2026-07-13T20:01:00.000Z',
          observationIds: [],
        })),
        incidentIds: ['health:search:degraded'],
      },
    },
    summary: {
      checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 1, advisory: 0, unknown: 0, acknowledged: 0 },
    },
  }
}

describe('canonical Health HTTP report schema', () => {
  it('accepts a report whose identities, references, and summaries reconcile', () => {
    expect(healthReportSchema.safeParse(canonicalReport()).success).toBe(true)
  })

  it('requires each canonical Search readiness stage exactly once', () => {
    const report = canonicalReport()
    report.subsystems.search.stages[3] = {
      ...report.subsystems.search.stages[3]!,
      key: 'engine',
    }

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects duplicate check ids', () => {
    const report = canonicalReport()
    report.checks.push(structuredClone(report.checks[0]!))
    report.summary.checks.registered = 2
    report.summary.checks.completed = 2

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects duplicate observation ids', () => {
    const report = canonicalReport()
    report.observations.push(structuredClone(report.observations[0]!))

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects duplicate incident ids', () => {
    const report = canonicalReport()
    report.incidents.push(structuredClone(report.incidents[0]!))
    report.summary.incidents.watching = 2

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects an observation that references an incident outside the report', () => {
    const report = canonicalReport()
    report.observations[0]!.incidentId = 'health:search:missing'

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects an incident that references an observation outside the report', () => {
    const report = canonicalReport()
    report.incidents[0]!.observationIds = ['health.search:missing']

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it.each([
    'registered',
    'completed',
    'failed',
    'invalid',
    'notApplicable',
  ] as const)('reconciles the %s check summary with current executions', (key) => {
    const report = canonicalReport()
    report.summary.checks[key] += 1

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })

  it.each([
    'actionRequired',
    'watching',
    'advisory',
    'unknown',
  ] as const)('reconciles the %s incident summary with current incidents', (key) => {
    const report = canonicalReport()
    report.summary.incidents[key] += 1

    expect(healthReportSchema.safeParse(report).success).toBe(false)
  })
})

describe('incident ackState wire mirror (health trust overhaul)', () => {
  // Lockstep rule: the mirror lagging the producer contract made the
  // client reject the ENTIRE report (rc.25). Pin both directions.
  it('accepts acked/snoozed and absent; rejects unknown values', () => {
    const base = {
      id: 'models:routing:premium-on-cheap-relay',
      status: 'warning',
      disposition: 'watch',
      effectiveDisposition: 'advisory',
      title: 'Premium model on cheap work',
      impact: 'Costs more than needed.',
      resources: [{ kind: 'agent', id: 'relay', label: 'relay' }],
      resolution: { key: 'rerun', type: 'rerun', label: 'Check again' },
      observationIds: ['obs-1'],
      observedAt: '2026-07-24T12:00:00.000Z',
      staleAt: '2026-07-24T13:00:00.000Z',
      stale: false,
    }
    expect(canonicalHealthIncidentSchema.safeParse(base).success).toBe(true)
    expect(canonicalHealthIncidentSchema.safeParse({ ...base, ackState: 'acked' }).success).toBe(true)
    expect(canonicalHealthIncidentSchema.safeParse({ ...base, ackState: 'snoozed' }).success).toBe(true)
    expect(canonicalHealthIncidentSchema.safeParse({ ...base, ackState: 'muted' }).success).toBe(false)
  })
})
