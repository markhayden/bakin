import type {
  HealthCheckState,
  HealthIncident,
  HealthObservation,
  HealthReport,
  HealthReportStatus,
  SearchReadiness,
  SearchReadinessStage,
  SearchReadinessStageKey,
  SearchStageStatus,
} from '@makinbakin/sdk/types'
import type { HealthSummary, LiveNowData } from '../types'

export type OverviewTone = 'neutral' | 'success' | 'warning' | 'destructive'
export type EvidenceFreshness = 'fresh' | 'stale'

export interface OverviewIncident {
  incident: HealthIncident
  observations: HealthObservation[]
  oldestEvidenceAt: string
  freshness: EvidenceFreshness
  verificationFailure: boolean
}

export interface OverviewSearchStage {
  key: SearchReadinessStageKey
  label: string
  status: SearchStageStatus
  statusLabel: string
  tone: OverviewTone
  summary: string
  observedAt: string | null
  stale: boolean
  observationIds: string[]
}

export interface OverviewSearch {
  status: SearchReadiness['status']
  statusLabel: string
  tone: OverviewTone
  summary: string
  observedAt: string | null
  stale: boolean
  stages: OverviewSearchStage[]
}

export interface HealthOverviewViewModel {
  reportId: string | null
  canonicalStatus: HealthReportStatus | null
  overallStatus: HealthReportStatus | null
  overallLabel: string
  overallSummary: string
  overallTone: OverviewTone
  evidenceObservedAt: string | null
  evidenceStale: boolean
  needsAction: OverviewIncident[]
  unableToVerify: OverviewIncident[]
  watching: OverviewIncident[]
  /**
   * Fresh advisory incidents — raw advisories AND sensitivity-demoted
   * findings (#690). They ride the calm notices surface: demotion means
   * "visible but quiet", never hidden.
   */
  advisories: OverviewIncident[]
  search: OverviewSearch
  rightNow: {
    runningDispatches: number | null
    runningAgents: string[]
    connectedSessions: number | null
    recentFailures: number | null
    observedAt: string | null
  }
  healthy: boolean
}

export interface BuildHealthOverviewViewModelInput {
  report: HealthReport | null
  /** Newer canonical projection is used only when its report id matches upstream. */
  searchReadiness?: SearchReadiness | null
  summary?: HealthSummary | null
  liveNow?: LiveNowData | null
  now?: number
}

const SEARCH_STAGE_KEYS: readonly SearchReadinessStageKey[] = ['engine', 'queries', 'indexes', 'journal']
const SEARCH_STAGE_LABELS: Record<SearchReadinessStageKey, string> = {
  engine: 'Engine',
  queries: 'Queries',
  indexes: 'Indexes',
  journal: 'Journal',
}

const INCIDENT_STATUS_RANK: Record<HealthIncident['status'], number> = {
  error: 0,
  warning: 1,
  unknown: 2,
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function expired(value: string | null | undefined, now: number): boolean {
  const parsed = timestamp(value)
  return parsed !== null && parsed <= now
}

function oldest(values: Array<string | null | undefined>): string | null {
  let oldestValue: string | null = null
  let oldestTime = Number.POSITIVE_INFINITY
  for (const value of values) {
    const parsed = timestamp(value)
    if (parsed !== null && parsed < oldestTime) {
      oldestTime = parsed
      oldestValue = value ?? null
    }
  }
  return oldestValue
}

/** Pure freshness check shared by the report hook and the Overview model. */
export function healthReportNeedsFreshSweep(report: HealthReport, now: number = Date.now()): boolean {
  if (report.overallStatus === 'unknown_stale') return true
  if (report.checks.length < report.summary.checks.registered) return true
  if (report.checks.some((check) =>
    check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid')) return true
  if (report.incidents.some((incident) => incident.stale || expired(incident.staleAt, now))) return true
  if (report.observations.some((observation) => expired(observation.staleAt, now))) return true

  const search = report.subsystems.search
  if (search.observedAt === null || search.staleAt === null || expired(search.staleAt, now)) return true
  const byKey = new Map(search.stages.map((stage) => [stage.key, stage]))
  return SEARCH_STAGE_KEYS.some((key) => {
    const stage = byKey.get(key)
    if (!stage) return true
    if (stage.status === 'not_applicable') return false
    return stage.observedAt === null || stage.staleAt === null || expired(stage.staleAt, now)
  })
}

function statusPresentation(status: HealthReportStatus | null): {
  label: string
  summary: string
  tone: OverviewTone
} {
  switch (status) {
    case 'healthy':
      return { label: 'Healthy', summary: 'Everything looks healthy.', tone: 'success' }
    case 'needs_attention':
      return { label: 'Needs attention', summary: 'Some problems need your attention.', tone: 'destructive' }
    case 'degraded':
      return { label: 'Watching', summary: 'Bakin is working, but some items need watching.', tone: 'warning' }
    case 'unknown_stale':
      return { label: 'Unable to verify', summary: 'Bakin could not confirm its health.', tone: 'neutral' }
    default:
      return { label: 'Checking health', summary: 'Checking whether Bakin is working.', tone: 'neutral' }
  }
}

function searchStatusPresentation(status: SearchStageStatus): { label: string; tone: OverviewTone } {
  switch (status) {
    case 'healthy': return { label: 'Healthy', tone: 'success' }
    case 'degraded': return { label: 'Degraded', tone: 'warning' }
    case 'unhealthy': return { label: 'Unhealthy', tone: 'destructive' }
    case 'unknown': return { label: 'Unknown', tone: 'neutral' }
    case 'not_applicable': return { label: 'Not applicable', tone: 'neutral' }
  }
}

function normalizeSearchStage(
  key: SearchReadinessStageKey,
  source: SearchReadinessStage | undefined,
  now: number,
): OverviewSearchStage {
  const label = SEARCH_STAGE_LABELS[key]
  if (!source) {
    const status = searchStatusPresentation('unknown')
    return {
      key, label, status: 'unknown', statusLabel: status.label, tone: status.tone,
      summary: `No current ${label} evidence is available.`,
      observedAt: null, stale: true, observationIds: [],
    }
  }

  const stale = source.status !== 'not_applicable'
    && (source.observedAt === null || source.staleAt === null || expired(source.staleAt, now))
  const displayStatus: SearchStageStatus = stale ? 'unknown' : source.status
  const presentation = searchStatusPresentation(displayStatus)
  return {
    key,
    label,
    status: displayStatus,
    statusLabel: presentation.label,
    tone: presentation.tone,
    summary: stale
      ? `${label} evidence is stale. Last reported: ${source.summary}`
      : source.summary || `${label} readiness is ${presentation.label.toLowerCase()}.`,
    observedAt: source.observedAt,
    stale,
    observationIds: [...source.observationIds],
  }
}

function normalizedSearchStatus(
  readiness: SearchReadiness | null | undefined,
  stages: readonly OverviewSearchStage[],
  now: number,
): SearchReadiness['status'] {
  if (!readiness || readiness.observedAt === null || readiness.staleAt === null || expired(readiness.staleAt, now)) {
    return 'unknown'
  }
  if (stages.some((stage) => stage.status === 'unhealthy')) return 'unhealthy'
  if (stages.some((stage) => stage.status === 'unknown')) return 'unknown'
  if (stages.some((stage) => stage.status === 'degraded')) return 'degraded'
  return readiness.status
}

function buildSearch(readiness: SearchReadiness | null | undefined, now: number): OverviewSearch {
  const byKey = new Map(readiness?.stages.map((stage) => [stage.key, stage]) ?? [])
  const stages = SEARCH_STAGE_KEYS.map((key) => normalizeSearchStage(key, byKey.get(key), now))
  const status = normalizedSearchStatus(readiness, stages, now)
  const presentation = searchStatusPresentation(status)
  const stale = status === 'unknown' && (readiness?.status !== 'unknown' || stages.some((stage) => stage.stale))
  return {
    status,
    statusLabel: presentation.label,
    tone: presentation.tone,
    summary: readiness && status === readiness.status
      ? readiness.summary
      : 'Search readiness evidence is incomplete or stale.',
    observedAt: readiness?.observedAt ?? null,
    stale,
    stages,
  }
}

function isVerificationFailure(
  observations: readonly HealthObservation[],
  checks: ReadonlyMap<string, HealthCheckState>,
): boolean {
  return observations.some((observation) => {
    const outcome = checks.get(observation.checkId)?.latestExecution.outcome
    if (outcome === 'failed' || outcome === 'invalid') return true
    return observation.group.key === 'verification'
      && (observation.key.includes('missing') || observation.key.includes('conflict'))
  })
}

function incidentModel(
  incident: HealthIncident,
  observationById: ReadonlyMap<string, HealthObservation>,
  checkById: ReadonlyMap<string, HealthCheckState>,
  now: number,
): OverviewIncident {
  const observations = incident.observationIds
    .map((id) => observationById.get(id))
    .filter((row): row is HealthObservation => row !== undefined)
    .sort((left, right) =>
      (timestamp(left.observedAt) ?? Number.POSITIVE_INFINITY)
        - (timestamp(right.observedAt) ?? Number.POSITIVE_INFINITY)
        || left.id.localeCompare(right.id))
  return {
    incident,
    observations,
    oldestEvidenceAt: oldest([incident.observedAt, ...observations.map((row) => row.observedAt)]) ?? incident.observedAt,
    freshness: incident.stale || expired(incident.staleAt, now) ? 'stale' : 'fresh',
    verificationFailure: isVerificationFailure(observations, checkById),
  }
}

function compareAction(left: OverviewIncident, right: OverviewIncident): number {
  return INCIDENT_STATUS_RANK[left.incident.status] - INCIDENT_STATUS_RANK[right.incident.status]
    || Number(left.freshness === 'stale') - Number(right.freshness === 'stale')
    || left.incident.title.localeCompare(right.incident.title)
    || left.incident.id.localeCompare(right.incident.id)
}

function compareUnable(left: OverviewIncident, right: OverviewIncident): number {
  return Number(right.verificationFailure) - Number(left.verificationFailure)
    || Number(left.freshness === 'stale') - Number(right.freshness === 'stale')
    || (timestamp(left.oldestEvidenceAt) ?? Number.POSITIVE_INFINITY)
      - (timestamp(right.oldestEvidenceAt) ?? Number.POSITIVE_INFINITY)
    || left.incident.id.localeCompare(right.incident.id)
}

function compareWatching(left: OverviewIncident, right: OverviewIncident): number {
  return left.incident.title.localeCompare(right.incident.title)
    || left.incident.id.localeCompare(right.incident.id)
}

function connectedSessions(summary: HealthSummary | null | undefined): number | null {
  const sessions = summary?.activeSessions
  return sessions ? sessions.reduce((total, session) => total + session.sessions, 0) : null
}

export function buildHealthOverviewViewModel({
  report,
  searchReadiness,
  summary,
  liveNow,
  now = Date.now(),
}: BuildHealthOverviewViewModelInput): HealthOverviewViewModel {
  const observationById = new Map(report?.observations.map((row) => [row.id, row]) ?? [])
  const checkById = new Map(report?.checks.map((row) => [row.checkId, row]) ?? [])
  const needsAction: OverviewIncident[] = []
  const unableToVerify: OverviewIncident[] = []
  const watching: OverviewIncident[] = []
  const advisories: OverviewIncident[] = []

  for (const incident of report?.incidents ?? []) {
    const row = incidentModel(incident, observationById, checkById, now)
    if (incident.effectiveDisposition === 'action_required') {
      needsAction.push(row)
    } else if (incident.status === 'unknown' || row.freshness === 'stale') {
      // Advisory unknowns are SELF-RESOLVING states the producer vouched
      // for (a scan warming up after restart, attribution completing as
      // transcripts land). Routing every unknown into the "Fix first"
      // banner regardless of disposition kept the dashboard permanently
      // lit with cards nobody should act on (field feedback, 2026-07-22).
      // Stale evidence still verifies — staleness means the vouching is
      // out of date.
      if (incident.effectiveDisposition === 'advisory' && row.freshness !== 'stale') {
        advisories.push(row)
      } else {
        unableToVerify.push(row)
      }
    } else if (incident.effectiveDisposition === 'watch' && incident.status === 'warning') {
      watching.push(row)
    } else if (incident.effectiveDisposition === 'advisory' && incident.status === 'warning') {
      advisories.push(row)
    }
  }
  needsAction.sort(compareAction)
  unableToVerify.sort(compareUnable)
  watching.sort(compareWatching)
  advisories.sort(compareWatching)

  const evidenceStale = report ? healthReportNeedsFreshSweep(report, now) : false
  const overallStatus = report === null
    ? null
    : report.overallStatus === 'needs_attention'
      ? 'needs_attention'
      : evidenceStale
        ? 'unknown_stale'
        : report.overallStatus
  const overall = statusPresentation(overallStatus)
  const canonicalSearch = searchReadiness ?? report?.subsystems.search
  const search = buildSearch(canonicalSearch, now)
  const evidenceObservedAt = report === null ? null : oldest([
    ...report.observations.map((row) => row.observedAt),
    ...report.checks.map((row) => row.latestExecution.completedAt),
    ...search.stages.map((stage) => stage.observedAt),
  ]) ?? report.lastFullSweep?.completedAt ?? null

  return {
    reportId: report?.id ?? null,
    canonicalStatus: report?.overallStatus ?? null,
    overallStatus,
    overallLabel: overall.label,
    overallSummary: overall.summary,
    overallTone: overall.tone,
    evidenceObservedAt,
    evidenceStale,
    needsAction,
    unableToVerify,
    watching,
    advisories,
    search,
    rightNow: {
      runningDispatches: liveNow?.runs.length ?? null,
      runningAgents: [...new Set(liveNow?.runs.map((run) => run.agent) ?? [])].sort(),
      connectedSessions: connectedSessions(summary),
      recentFailures: summary?.errors1h?.total ?? null,
      observedAt: liveNow?.generatedAt ?? null,
    },
    healthy: overallStatus === 'healthy'
      && search.status === 'healthy'
      && needsAction.length === 0
      && unableToVerify.length === 0
      && watching.length === 0,
  }
}
