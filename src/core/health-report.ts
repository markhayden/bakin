import type {
  HealthCheckState,
  HealthDisposition,
  HealthIncident,
  HealthIncidentInput,
  HealthObservation,
  HealthObservationStatus,
  HealthReportStatus,
  HealthResolution,
  HealthResource,
} from '@makinbakin/sdk/types'

type IncidentBearingObservation = HealthObservation & {
  incident?: HealthIncidentInput
}

const statusRank: Record<Exclude<HealthObservationStatus, 'healthy'>, number> = {
  error: 3,
  unknown: 2,
  warning: 1,
}

const dispositionRank: Record<HealthDisposition, number> = {
  action_required: 3,
  watch: 2,
  advisory: 1,
}

/** Contract conflicts are producer bugs, not a presentation choice. */
export class HealthIncidentConflictError extends Error {
  readonly code = 'HEALTH_INCIDENT_CONFLICT'

  constructor(readonly incidentId: string, readonly field: 'title' | 'impact' | 'resolution') {
    super(`Health incident ${incidentId} has conflicting ${field} declarations`)
    this.name = 'HealthIncidentConflictError'
  }
}

function earlier(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right
}

function stableResolution(resolution: HealthResolution): string {
  return JSON.stringify(resolution, Object.keys(resolution).sort())
}

function dedupeResources(resources: readonly HealthResource[]): HealthResource[] {
  const byId = new Map<string, HealthResource>()
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id}`
    const current = byId.get(key)
    if (!current || (!current.label && resource.label)) byId.set(key, resource)
  }
  return [...byId.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  )
}

function assertCompatibleIncident(
  id: string,
  existing: Pick<HealthIncident, 'title' | 'impact' | 'resolution'>,
  candidate: HealthIncidentInput,
): void {
  if (existing.title !== candidate.title) throw new HealthIncidentConflictError(id, 'title')
  if (existing.impact !== candidate.impact) throw new HealthIncidentConflictError(id, 'impact')
  if (stableResolution(existing.resolution) !== stableResolution(candidate.resolution)) {
    throw new HealthIncidentConflictError(id, 'resolution')
  }
}

/**
 * Merge canonical observations by their already owner-scoped incident id.
 * Copy never participates in identity; conflicting copy is rejected.
 */
export function buildHealthIncidents(
  observations: readonly HealthObservation[],
  generatedAt: string,
): HealthIncident[] {
  const merged = new Map<string, HealthIncident>()

  for (const raw of observations as readonly IncidentBearingObservation[]) {
    if (raw.status === 'healthy' || !raw.incidentId || !raw.incident) continue
    const status = raw.status as Exclude<HealthObservationStatus, 'healthy'>
    const existing = merged.get(raw.incidentId)
    if (!existing) {
      merged.set(raw.incidentId, {
        id: raw.incidentId,
        status,
        disposition: raw.incident.disposition,
        title: raw.incident.title,
        impact: raw.incident.impact,
        resources: dedupeResources(raw.incident.resources ?? []),
        resolution: raw.incident.resolution,
        observationIds: [raw.id],
        observedAt: raw.observedAt,
        staleAt: raw.staleAt,
        stale: Date.parse(raw.staleAt) <= Date.parse(generatedAt),
      })
      continue
    }

    assertCompatibleIncident(raw.incidentId, existing, raw.incident)
    existing.status = statusRank[status] > statusRank[existing.status] ? status : existing.status
    existing.disposition = dispositionRank[raw.incident.disposition] > dispositionRank[existing.disposition]
      ? raw.incident.disposition
      : existing.disposition
    existing.resources = dedupeResources([...existing.resources, ...(raw.incident.resources ?? [])])
    existing.observationIds = [...new Set([...existing.observationIds, raw.id])].sort()
    existing.observedAt = earlier(existing.observedAt, raw.observedAt)
    existing.staleAt = earlier(existing.staleAt, raw.staleAt)
    existing.stale = Date.parse(existing.staleAt) <= Date.parse(generatedAt)
  }

  return sortHealthIncidents([...merged.values()])
}

/** Stable incident ordering shared by the report, CLI, and UI. */
export function sortHealthIncidents(incidents: readonly HealthIncident[]): HealthIncident[] {
  return [...incidents].sort((a, b) =>
    dispositionRank[b.disposition] - dispositionRank[a.disposition]
      || statusRank[b.status] - statusRank[a.status]
      || Number(a.stale) - Number(b.stale)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id),
  )
}

export interface HealthStatusInput {
  registeredChecks: number
  checks: readonly HealthCheckState[]
  incidents: readonly HealthIncident[]
}

/** Exact server-side overall-status precedence from the Health contract. */
export function deriveHealthReportStatus(input: HealthStatusInput): HealthReportStatus {
  if (input.incidents.some((incident) => incident.disposition === 'action_required')) {
    return 'needs_attention'
  }

  const incomplete = input.checks.length < input.registeredChecks
    || input.checks.some((state) =>
      state.latestExecution.outcome === 'failed'
        || state.latestExecution.outcome === 'invalid',
    )
  const unknownOrStale = incomplete || input.incidents.some((incident) =>
    incident.status === 'unknown' || incident.stale,
  )
  if (unknownOrStale) return 'unknown_stale'
  if (input.incidents.some((incident) => incident.disposition === 'watch')) return 'degraded'
  return 'healthy'
}

