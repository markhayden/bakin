import type {
  HealthCheckState,
  HealthDisposition,
  HealthIncident,
  HealthIncidentClass,
  HealthIncidentInput,
  HealthObservation,
  HealthObservationStatus,
  HealthReportStatus,
  HealthResolution,
  HealthResource,
  HealthSensitivity,
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

  constructor(readonly incidentId: string, readonly field: 'title' | 'impact' | 'resolution' | 'class') {
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
  existing: Pick<HealthIncident, 'title' | 'impact' | 'resolution' | 'class'>,
  candidate: HealthIncidentInput,
): void {
  if (existing.title !== candidate.title) throw new HealthIncidentConflictError(id, 'title')
  if (existing.impact !== candidate.impact) throw new HealthIncidentConflictError(id, 'impact')
  if (stableResolution(existing.resolution) !== stableResolution(candidate.resolution)) {
    throw new HealthIncidentConflictError(id, 'resolution')
  }
  if (existing.class !== candidate.class) throw new HealthIncidentConflictError(id, 'class')
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
        // Raw until projectEffectiveDispositions runs over the merged set.
        effectiveDisposition: raw.incident.disposition,
        ...(raw.incident.class ? { class: raw.incident.class } : {}),
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
    existing.effectiveDisposition = existing.disposition
    existing.resources = dedupeResources([...existing.resources, ...(raw.incident.resources ?? [])])
    existing.observationIds = [...new Set([...existing.observationIds, raw.id])].sort()
    existing.observedAt = earlier(existing.observedAt, raw.observedAt)
    existing.staleAt = earlier(existing.staleAt, raw.staleAt)
    existing.stale = Date.parse(existing.staleAt) <= Date.parse(generatedAt)
  }

  return sortHealthIncidents([...merged.values()])
}

/** Stable incident ordering shared by the report, CLI, and UI — effective urgency first. */
export function sortHealthIncidents(incidents: readonly HealthIncident[]): HealthIncident[] {
  return [...incidents].sort((a, b) =>
    dispositionRank[b.effectiveDisposition] - dispositionRank[a.effectiveDisposition]
      || statusRank[b.status] - statusRank[a.status]
      || Number(a.stale) - Number(b.stale)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id),
  )
}

/**
 * The ONE sensitivity policy (#690): class × sensitivity → effective
 * disposition. Caps only ever LOWER urgency, never raise it; incidents whose
 * observation status is 'error' are never demoted (belt-and-braces on top of
 * the uncapped classes); an unclassified incident is treated as
 * service_failure (never demoted) so a missing stamp cannot hide an outage.
 * evidence_gap is deliberately uncapped — its producers split raw severity
 * (rule-affecting = watch, informational = advisory) per D12. Quiet's extra
 * behavior lives at the NOTIFICATION layer (badge/escalation act only on
 * action_required), not in these caps.
 */
const DEMOTABLE_TO_ADVISORY: ReadonlySet<HealthIncidentClass> = new Set([
  'usage_anomaly',
  'cleanup_backlog',
  'policy_denial',
  'unsupported_surface',
])

export function projectEffectiveDispositions(
  incidents: readonly HealthIncident[],
  sensitivity: HealthSensitivity,
): HealthIncident[] {
  return incidents.map((incident) => {
    // Evidence state is not demotable: error means a real failure and
    // unknown means unverified evidence — both keep their raw urgency in
    // every mode so the badge, cards, and overall status tell one story.
    const demote = sensitivity !== 'developer'
      && incident.status !== 'error'
      && incident.status !== 'unknown'
      && incident.class !== undefined
      && DEMOTABLE_TO_ADVISORY.has(incident.class)
      && dispositionRank[incident.disposition] > dispositionRank.advisory
    return { ...incident, effectiveDisposition: demote ? 'advisory' as const : incident.disposition }
  })
}

export interface HealthStatusInput {
  registeredChecks: number
  checks: readonly HealthCheckState[]
  incidents: readonly HealthIncident[]
}

/**
 * Exact server-side overall-status precedence from the Health contract.
 * Urgency (needs_attention/degraded) is computed over EFFECTIVE dispositions
 * (#690), but evidence honesty is NOT demotable: unknown-status or stale
 * incidents drive unknown_stale regardless of sensitivity — missing or
 * unverified evidence must never read as an all-clear (the
 * unknown-is-never-healthy contract).
 */
export function deriveHealthReportStatus(input: HealthStatusInput): HealthReportStatus {
  if (input.incidents.some((incident) => incident.effectiveDisposition === 'action_required')) {
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
  if (input.incidents.some((incident) => incident.effectiveDisposition === 'watch')) return 'degraded'
  return 'healthy'
}

