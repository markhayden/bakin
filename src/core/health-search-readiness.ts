import type {
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  SearchReadiness,
  SearchReadinessStage,
  SearchReadinessStageKey,
  SearchStageStatus,
} from '@makinbakin/sdk/types'

const STAGE_LABELS: Record<SearchReadinessStageKey, string> = {
  engine: 'Engine',
  queries: 'Queries',
  indexes: 'Indexes',
  journal: 'Journal',
}

const STAGE_ORDER: SearchReadinessStageKey[] = ['engine', 'queries', 'indexes', 'journal']

const CHECK_STAGE_BY_LOCAL_ID: Record<string, SearchReadinessStageKey[]> = {
  search: ['engine', 'indexes', 'journal'],
  'search-consistency': ['indexes'],
  'search-spin': ['indexes'],
  'search-canary': ['queries'],
  'search-engine-burn': ['engine'],
}

function stageForObservation(observation: HealthObservation): SearchReadinessStageKey | null {
  if (observation.group.key !== 'search') return null
  for (const key of STAGE_ORDER) {
    if (observation.key === key || observation.key.startsWith(`${key}.`)) return key
  }
  return null
}

function expectedStagesForCheck(checkId: string): SearchReadinessStageKey[] {
  const localId = checkId.split('.').at(-1) ?? checkId
  return CHECK_STAGE_BY_LOCAL_ID[localId] ?? []
}

function oldest(values: readonly string[]): string | null {
  if (values.length === 0) return null
  return [...values].sort((a, b) => Date.parse(a) - Date.parse(b))[0]
}

function stageStatus(
  observations: readonly HealthObservation[],
  incidentById: ReadonlyMap<string, HealthIncident>,
  generatedAt: string,
): SearchStageStatus {
  if (observations.length === 0) return 'unknown'

  const freshAction = observations.some((observation) => {
    if (observation.status === 'healthy' || Date.parse(observation.staleAt) <= Date.parse(generatedAt)) return false
    const incident = observation.incidentId ? incidentById.get(observation.incidentId) : undefined
    return observation.status === 'error' || incident?.disposition === 'action_required'
  })
  if (freshAction) return 'unhealthy'

  if (observations.some((observation) =>
    observation.status === 'unknown'
      || observation.snapshot === 'last_known'
      || Date.parse(observation.staleAt) <= Date.parse(generatedAt)
      || (observation.status !== 'healthy' && !observation.incidentId),
  )) return 'unknown'

  if (observations.some((observation) => observation.status === 'warning')) return 'degraded'
  return 'healthy'
}

function stageSummary(key: SearchReadinessStageKey, status: SearchStageStatus): string {
  const label = STAGE_LABELS[key]
  switch (status) {
    case 'healthy': return `${label} checks are healthy.`
    case 'degraded': return `${label} is operating with a degraded condition.`
    case 'unhealthy': return `${label} has an issue that requires attention.`
    case 'not_applicable': return `${label} is not applicable in this configuration.`
    case 'unknown': return `${label} could not be verified.`
  }
}

function deriveStage(
  key: SearchReadinessStageKey,
  observations: readonly HealthObservation[],
  incidentById: ReadonlyMap<string, HealthIncident>,
  generatedAt: string,
): SearchReadinessStage {
  const status = stageStatus(observations, incidentById, generatedAt)
  return {
    key,
    label: STAGE_LABELS[key],
    status,
    summary: stageSummary(key, status),
    observedAt: oldest(observations.map((observation) => observation.observedAt)),
    staleAt: oldest(observations.map((observation) => observation.staleAt)),
    observationIds: observations.map((observation) => observation.id).sort(),
  }
}

export interface SearchReadinessInput {
  observations: readonly HealthObservation[]
  incidents: readonly HealthIncident[]
  checks?: readonly HealthCheckState[]
  generatedAt: string
}

/** Pure canonical Search classifier used by the report and readiness route. */
export function deriveSearchReadiness(input: SearchReadinessInput): SearchReadiness {
  const searchObservations = input.observations.filter((observation) => observation.group.key === 'search')
  const searchChecks = (input.checks ?? []).filter((check) => check.group.key === 'search')
  const allNotApplicable = searchChecks.length > 0
    && searchChecks.every((check) => check.latestExecution.outcome === 'not_applicable'
      && !input.observations.some((observation) =>
        observation.checkId === check.checkId
          && observation.status === 'unknown'
          && observation.group.key === 'verification',
      ))
  const incidentById = new Map(input.incidents.map((incident) => [incident.id, incident]))

  const observationsByStage = new Map<SearchReadinessStageKey, HealthObservation[]>(
    STAGE_ORDER.map((key) => [key, searchObservations.filter((observation) => stageForObservation(observation) === key)]),
  )
  // Failed, invalid, missing, or stale Search checks publish a core-owned
  // verification observation. Associate it with every stage that registration
  // is required to prove so old evidence cannot hide an unverifiable attempt.
  for (const check of searchChecks) {
    const verification = input.observations.filter((observation) =>
      observation.checkId === check.checkId
        && observation.status === 'unknown'
        && observation.group.key === 'verification',
    )
    if (verification.length === 0) continue
    for (const key of expectedStagesForCheck(check.checkId)) {
      observationsByStage.get(key)?.push(...verification)
    }
  }

  const stages = STAGE_ORDER.map((key): SearchReadinessStage => {
    if (allNotApplicable) {
      return {
        key,
        label: STAGE_LABELS[key],
        status: 'not_applicable',
        summary: stageSummary(key, 'not_applicable'),
        observedAt: null,
        staleAt: null,
        observationIds: [],
      }
    }
    return deriveStage(
      key,
      observationsByStage.get(key) ?? [],
      incidentById,
      input.generatedAt,
    )
  })

  let status: SearchReadiness['status']
  if (stages.some((stage) => stage.status === 'unhealthy')) status = 'unhealthy'
  else if (stages.some((stage) => stage.status === 'unknown')) status = 'unknown'
  else if (stages.some((stage) => stage.status === 'degraded')) status = 'degraded'
  else status = 'healthy'

  const projectedObservations = [...new Set([...observationsByStage.values()].flat())]
  const incidentIds = [...new Set(projectedObservations.flatMap((observation) =>
    observation.incidentId ? [observation.incidentId] : [],
  ))].sort()
  const observedAt = oldest(stages.flatMap((stage) => stage.observedAt ? [stage.observedAt] : []))
  const staleAt = oldest(stages.flatMap((stage) => stage.staleAt ? [stage.staleAt] : []))

  return {
    status,
    summary: status === 'healthy'
      ? 'Search is healthy across engine, queries, indexes, and journal.'
      : status === 'degraded'
        ? 'Search is available with a degraded stage.'
        : status === 'unhealthy'
          ? 'Search has a stage that requires attention.'
          : 'Search readiness could not be fully verified.',
    observedAt,
    staleAt,
    stages,
    incidentIds,
  }
}
