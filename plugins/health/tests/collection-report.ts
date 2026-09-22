import type { HealthCheckState, HealthObservation, HealthReport } from '@makinbakin/sdk/types'
const OBSERVED_AT = '2026-01-15T11:55:00.000Z'
const STALE_AT = '2099-01-15T12:00:00.000Z'
function healthyObservation(): HealthObservation {
  return {
    id: 'observation:runtime', key: 'host', status: 'healthy', summary: 'The host process is responsive.',
    checkId: 'runtime.host', checkName: 'Host process',
    owner: { kind: 'core', id: 'core', label: 'Bakin' }, group: { key: 'runtime', label: 'Runtime checks' },
    checkedAt: OBSERVED_AT, observedAt: OBSERVED_AT, staleAt: STALE_AT, snapshot: 'current',
  }
}

function report(): HealthReport {
  const healthy = healthyObservation()
  const healthyCheck: HealthCheckState = {
    checkId: healthy.checkId, checkName: healthy.checkName, description: 'Verifies the host can answer requests.',
    owner: healthy.owner, group: healthy.group,
    latestExecution: {
      id: 'execution:runtime', checkId: healthy.checkId, startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'observed',
    },
    latestValidSnapshot: { executionId: 'execution:runtime', observations: [healthy] },
  }
  const notApplicable: HealthCheckState = {
    checkId: 'optional.cloud', checkName: 'Cloud connector', description: 'Verifies the optional cloud connector.',
    owner: { kind: 'plugin', id: 'cloud', label: 'Cloud' }, group: { key: 'optional', label: 'Optional services' },
    latestExecution: {
      id: 'execution:cloud', checkId: 'optional.cloud', startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'not_applicable', reason: 'Cloud sync is not configured.',
    },
  }
  const failed: HealthCheckState = {
    checkId: 'search.probe', checkName: 'Search verification probe', description: 'Verifies an end-to-end Search query.',
    owner: { kind: 'core', id: 'core', label: 'Bakin' }, group: { key: 'search', label: 'Search checks' },
    latestExecution: {
      id: 'execution:search', checkId: 'search.probe', startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'failed', error: { code: 'timeout', message: 'The verification query timed out.' },
    },
  }
  return {
    id: 'report-1', revision: 1, generatedAt: OBSERVED_AT, overallStatus: 'degraded', sensitivity: 'developer' as const,
    lastFullSweep: { id: 'sweep-1', startedAt: OBSERVED_AT, completedAt: OBSERVED_AT },
    checks: [healthyCheck, notApplicable, failed], observations: [healthy], incidents: [],
    subsystems: {
      search: {
        status: 'degraded', summary: 'Search answers queries, but one index migration needs attention.',
        observedAt: OBSERVED_AT, staleAt: STALE_AT, incidentIds: [],
        stages: [
          { key: 'engine', label: 'Engine', status: 'healthy', summary: 'Engine is connected.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'queries', label: 'Queries', status: 'healthy', summary: 'Queries are answering.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'indexes', label: 'Indexes', status: 'degraded', summary: 'One migration is parked.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'journal', label: 'Journal', status: 'healthy', summary: 'Journal is draining.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
        ],
      },
    },
    summary: {
      checks: { registered: 3, completed: 2, failed: 1, invalid: 0, notApplicable: 1 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
    },
  }
}

export const collectionReport = report()
collectionReport.incidents = [{ id: 'search-timeout', status: 'warning', disposition: 'action_required', effectiveDisposition: 'action_required', title: 'Search verification needs review', impact: 'The verification query timed out; existing records remain available.', resources: [], resolution: { key: 'again', type: 'rerun', label: 'Check again' }, observationIds: [], observedAt: OBSERVED_AT, staleAt: STALE_AT, stale: false }]
collectionReport.summary.incidents.actionRequired = 1
