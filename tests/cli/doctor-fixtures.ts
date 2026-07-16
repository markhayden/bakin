import type {
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  HealthReport,
  HealthReportStatus,
} from '@makinbakin/sdk/types'

export const healthTimestamp = '2026-07-12T12:00:00.000Z'
export const healthStaleAt = '2026-07-12T12:05:00.000Z'

const owner = { kind: 'plugin' as const, id: 'tasks', label: 'Tasks' }
const group = { key: 'work', label: 'Work' }

export const actionableObservation: HealthObservation = {
  id: 'tasks.taskboard:missing-columns',
  key: 'missing-columns',
  status: 'error',
  summary: 'Task board columns are missing.',
  detail: 'The todo and done columns need to be restored.',
  checkId: 'tasks.taskboard',
  checkName: 'Task board',
  owner,
  group,
  checkedAt: healthTimestamp,
  observedAt: healthTimestamp,
  staleAt: healthStaleAt,
  snapshot: 'current',
  incidentId: 'tasks:work:missing-columns',
  incident: {
    key: 'missing-columns',
    title: 'Task board columns are missing',
    impact: 'New work cannot move through the normal board workflow.',
    disposition: 'action_required',
    resources: [{ kind: 'task', id: 'board', label: 'Task board' }],
    resolution: {
      key: 'restore-columns',
      type: 'repair',
      label: 'Restore board columns',
      actionId: 'repair-taskboard',
    },
  },
}

export const actionableIncident: HealthIncident = {
  id: actionableObservation.incidentId,
  status: 'error',
  disposition: 'action_required',
  title: actionableObservation.incident.title,
  impact: actionableObservation.incident.impact,
  resources: actionableObservation.incident.resources ?? [],
  resolution: actionableObservation.incident.resolution,
  observationIds: [actionableObservation.id],
  observedAt: healthTimestamp,
  staleAt: healthStaleAt,
  stale: false,
}

export const advisoryObservation: HealthObservation = {
  id: 'health.budget:usage-note',
  key: 'usage-note',
  status: 'warning',
  summary: 'Usage is trending upward.',
  checkId: 'health.budget',
  checkName: 'Budget trend',
  owner: { kind: 'plugin', id: 'health', label: 'Health' },
  group: { key: 'cost', label: 'Cost' },
  checkedAt: healthTimestamp,
  observedAt: healthTimestamp,
  staleAt: healthStaleAt,
  snapshot: 'current',
  incidentId: 'health:cost:usage-note',
  incident: {
    key: 'usage-note',
    title: 'Usage is trending upward',
    impact: 'No action is required yet.',
    disposition: 'advisory',
    resources: [{ kind: 'budget_rule', id: 'default' }],
    resolution: { key: 'view-budget', type: 'navigate', label: 'View budget', href: '/health' },
  },
}

export const advisoryIncident: HealthIncident = {
  id: advisoryObservation.incidentId,
  status: 'warning',
  disposition: 'advisory',
  title: advisoryObservation.incident.title,
  impact: advisoryObservation.incident.impact,
  resources: advisoryObservation.incident.resources ?? [],
  resolution: advisoryObservation.incident.resolution,
  observationIds: [advisoryObservation.id],
  observedAt: healthTimestamp,
  staleAt: healthStaleAt,
  stale: false,
}

export const unknownObservation: HealthObservation = {
  id: 'core.offline.runtime:unverified',
  key: 'unverified',
  status: 'unknown',
  summary: 'Runtime health has not been verified.',
  checkId: 'core.offline.runtime',
  checkName: 'Runtime health',
  owner: { kind: 'core', id: 'core', label: 'Bakin' },
  group: { key: 'offline-unverified', label: 'Requires server' },
  checkedAt: healthTimestamp,
  observedAt: healthTimestamp,
  staleAt: healthTimestamp,
  snapshot: 'current',
  incidentId: 'core:offline:runtime:unverified',
  incident: {
    key: 'runtime-unverified',
    title: 'Runtime health is unverified',
    impact: 'Offline diagnostics cannot confirm the active runtime.',
    disposition: 'watch',
    resources: [{ kind: 'runtime', id: 'active' }],
    resolution: { key: 'rerun-full', type: 'rerun', label: 'Run full diagnostics' },
  },
}

export const unknownIncident: HealthIncident = {
  id: unknownObservation.incidentId,
  status: 'unknown',
  disposition: 'watch',
  title: unknownObservation.incident.title,
  impact: unknownObservation.incident.impact,
  resources: unknownObservation.incident.resources ?? [],
  resolution: unknownObservation.incident.resolution,
  observationIds: [unknownObservation.id],
  observedAt: healthTimestamp,
  staleAt: healthTimestamp,
  stale: true,
}

export function checkState(observation: HealthObservation): HealthCheckState {
  const executionId = `execution:${observation.checkId}`
  return {
    checkId: observation.checkId,
    checkName: observation.checkName,
    description: `Checks ${observation.checkName.toLowerCase()}.`,
    owner: observation.owner,
    group: observation.group,
    latestExecution: {
      id: executionId,
      checkId: observation.checkId,
      startedAt: healthTimestamp,
      completedAt: healthTimestamp,
      outcome: 'observed',
    },
    latestValidSnapshot: { executionId, observations: [observation] },
  }
}

const searchStages = ([
  ['engine', 'Engine'],
  ['queries', 'Queries'],
  ['indexes', 'Indexes'],
  ['journal', 'Journal'],
] as const).map(([key, label]) => ({
  key,
  label,
  status: 'healthy' as const,
  summary: `${label} is healthy.`,
  observedAt: healthTimestamp,
  staleAt: healthStaleAt,
  observationIds: [] as string[],
}))

export function makeHealthReport(
  overallStatus: HealthReportStatus = 'healthy',
  overrides: Partial<HealthReport> = {},
): HealthReport {
  return {
    id: `health-report-${overallStatus}`,
    revision: 7,
    generatedAt: healthTimestamp,
    overallStatus,
    lastFullSweep: {
      id: 'sweep-7',
      startedAt: healthTimestamp,
      completedAt: healthTimestamp,
    },
    checks: [],
    observations: [],
    incidents: [],
    subsystems: {
      search: {
        status: 'healthy',
        summary: 'Search is healthy.',
        observedAt: healthTimestamp,
        staleAt: healthStaleAt,
        stages: searchStages,
        incidentIds: [],
      },
    },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0 },
    },
    ...overrides,
  }
}

export const actionableHealthReport = makeHealthReport('needs_attention', {
  id: 'health-report-actionable',
  checks: [checkState(actionableObservation)],
  observations: [actionableObservation],
  incidents: [actionableIncident],
  summary: {
    checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 1, watching: 0, advisory: 0, unknown: 0 },
  },
})

export const advisoryHealthReport = makeHealthReport('healthy', {
  id: 'health-report-advisory',
  checks: [checkState(advisoryObservation)],
  observations: [advisoryObservation],
  incidents: [advisoryIncident],
  summary: {
    checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 0, watching: 0, advisory: 1, unknown: 0 },
  },
})

export const unknownHealthReport = makeHealthReport('unknown_stale', {
  id: 'health-report-unknown',
  checks: [checkState(unknownObservation)],
  observations: [unknownObservation],
  incidents: [unknownIncident],
  summary: {
    checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 0, watching: 1, advisory: 0, unknown: 1 },
  },
})
