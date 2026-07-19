import type {
  ActionIncidentInput,
  AdvisoryIncidentInput,
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  HealthReport,
  SearchReadiness,
  WatchIncidentInput,
} from '@makinbakin/sdk/types'

const OBSERVED_AT = '2026-07-05T00:00:00.000Z'
const STALE_AT = '2026-07-05T00:05:00.000Z'
const OWNER = { kind: 'plugin', id: 'team', label: 'Team' } as const
const GROUP = { key: 'agents', label: 'Agents' } as const

const SEARCH_READINESS: SearchReadiness = {
  status: 'healthy',
  summary: 'Search is ready.',
  observedAt: OBSERVED_AT,
  staleAt: STALE_AT,
  incidentIds: [],
  stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
    key,
    label: key[0]!.toUpperCase() + key.slice(1),
    status: 'healthy',
    summary: `${key} is ready.`,
    observedAt: OBSERVED_AT,
    staleAt: STALE_AT,
    observationIds: [],
  })),
}

export function makeTeamHealthReport(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    id: 'health-report-team',
    revision: 4,
    generatedAt: OBSERVED_AT,
    overallStatus: 'healthy',
    sensitivity: 'developer',
    lastFullSweep: {
      id: 'health-sweep-team',
      startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT,
    },
    checks: [],
    observations: [],
    incidents: [],
    subsystems: { search: SEARCH_READINESS },
    summary: {
      checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0 },
    },
    ...overrides,
  }
}

interface FindingInput {
  observationId: string
  incidentId: string
  checkId: string
  checkName: string
  agentId: string
  disposition: 'action_required' | 'watch' | 'advisory'
}

function makeFinding(input: FindingInput): {
  observation: HealthObservation
  incident: HealthIncident
  check: HealthCheckState
} {
  const commonIncident = {
    key: input.incidentId,
    title: `${input.checkName} needs attention`,
    impact: `Agent ${input.agentId} may need operator attention.`,
    resources: [{ kind: 'agent' as const, id: input.agentId, label: input.agentId }],
    resolution: { key: 'rerun', type: 'rerun' as const, label: 'Run checks again' },
  }
  const commonObservation = {
    id: input.observationId,
    key: input.observationId,
    checkId: input.checkId,
    checkName: input.checkName,
    owner: OWNER,
    group: GROUP,
    summary: `${input.checkName} reported a finding for ${input.agentId}.`,
    checkedAt: OBSERVED_AT,
    observedAt: OBSERVED_AT,
    staleAt: STALE_AT,
    snapshot: 'current' as const,
    incidentId: input.incidentId,
  }

  let observation: HealthObservation
  let incident: HealthIncident
  if (input.disposition === 'action_required') {
    const incidentInput: ActionIncidentInput = {
      ...commonIncident,
      disposition: 'action_required',
    }
    observation = {
      ...commonObservation,
      status: 'error',
      incident: incidentInput,
    }
    incident = {
      id: input.incidentId,
      status: 'error',
      disposition: incidentInput.disposition,
      effectiveDisposition: incidentInput.disposition,
      title: incidentInput.title,
      impact: incidentInput.impact,
      resources: incidentInput.resources ?? [],
      resolution: incidentInput.resolution,
      observationIds: [input.observationId],
      observedAt: OBSERVED_AT,
      staleAt: STALE_AT,
      stale: false,
    }
  } else {
    const incidentInput: WatchIncidentInput | AdvisoryIncidentInput = input.disposition === 'watch'
      ? { ...commonIncident, disposition: 'watch' }
      : { ...commonIncident, disposition: 'advisory' }
    observation = {
      ...commonObservation,
      status: 'warning',
      incident: incidentInput,
    }
    incident = {
      id: input.incidentId,
      status: 'warning',
      disposition: incidentInput.disposition,
      effectiveDisposition: incidentInput.disposition,
      title: incidentInput.title,
      impact: incidentInput.impact,
      resources: incidentInput.resources ?? [],
      resolution: incidentInput.resolution,
      observationIds: [input.observationId],
      observedAt: OBSERVED_AT,
      staleAt: STALE_AT,
      stale: false,
    }
  }

  const executionId = `execution:${input.observationId}`
  return {
    observation,
    incident,
    check: {
      checkId: input.checkId,
      checkName: input.checkName,
      description: `Checks ${input.checkName.toLowerCase()} for an agent.`,
      owner: OWNER,
      group: GROUP,
      latestExecution: {
        id: executionId,
        checkId: input.checkId,
        startedAt: OBSERVED_AT,
        completedAt: OBSERVED_AT,
        outcome: 'observed',
      },
      latestValidSnapshot: { executionId, observations: [observation] },
    },
  }
}

const ATTENTION_FINDINGS = [
  makeFinding({
    observationId: 'obs-drift',
    incidentId: 'team:agents:pixel-drift',
    checkId: 'team.agent-sync',
    checkName: 'Agent package sync',
    agentId: 'pixel',
    disposition: 'action_required',
  }),
  makeFinding({
    observationId: 'obs-context',
    incidentId: 'health:context:pixel-size',
    checkId: 'health.context.startup-size',
    checkName: 'Startup context size',
    agentId: 'pixel',
    disposition: 'watch',
  }),
  makeFinding({
    observationId: 'obs-burn-advisory',
    incidentId: 'health:burn:pixel-advisory',
    checkId: 'health.usage.agent-burn',
    checkName: 'Agent token burn',
    agentId: 'pixel',
    disposition: 'advisory',
  }),
  makeFinding({
    observationId: 'obs-burn-other-agent',
    incidentId: 'health:burn:patch-action',
    checkId: 'health.usage.agent-burn',
    checkName: 'Agent token burn',
    agentId: 'patch',
    disposition: 'action_required',
  }),
]

export const HEALTHY_TEAM_HEALTH_REPORT = makeTeamHealthReport()

export const TEAM_ATTENTION_HEALTH_REPORT = makeTeamHealthReport({
  overallStatus: 'needs_attention',
  sensitivity: 'developer',
  checks: ATTENTION_FINDINGS.map((finding) => finding.check),
  observations: ATTENTION_FINDINGS.map((finding) => finding.observation),
  incidents: ATTENTION_FINDINGS.map((finding) => finding.incident),
  summary: {
    checks: { registered: 4, completed: 4, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 2, watching: 1, advisory: 1, unknown: 0 },
  },
})
