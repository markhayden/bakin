/** Per-check canonical Health cache and immutable report projection. */
import { createHash } from 'crypto'
import type {
  HealthCheckDef,
  HealthCheckExecution,
  HealthCheckState,
  HealthFullSweep,
  HealthIncident,
  HealthObservation,
  HealthReport,
} from '../../packages/core/src/plugin-types'
import type { DetailedHealthCheckRun } from './doctor-checks'
import {
  HealthAckNotFoundError,
  SNOOZE_MAX_MS,
  pruneAckRecords,
  readAckRecords,
  removeAckRecord,
  resolveAckState,
  resourceFingerprint,
  writeAckRecord,
  type HealthAckRecord,
  type HealthAckTier,
} from './health-acks'
import {
  buildHealthIncidents,
  deriveHealthReportStatus,
  projectEffectiveDispositions,
  sortHealthIncidents,
} from './health-report'
import { deriveSearchReadiness } from './health-search-readiness'
import { listHealthChecks, onHealthRegistryChanged } from './health-check-registry'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('doctor-report-cache')

interface CachedCheck {
  state: HealthCheckState
  latestAttemptObservations: HealthObservation[]
  notApplicableStaleAt?: string
}

const cache = new Map<string, CachedCheck>()
const listeners = new Set<(report: HealthReport) => void>()
let revision = 0
let lastFullSweep: HealthFullSweep | null = null
let lastPublishedProjection: { key: string; report: HealthReport } | null = null

function cloneObservation(observation: HealthObservation, snapshot = observation.snapshot): HealthObservation {
  return {
    ...observation,
    owner: { ...observation.owner },
    group: { ...observation.group },
    ...(observation.evidence ? { evidence: structuredClone(observation.evidence) } : {}),
    ...(observation.status === 'healthy'
      ? {}
      : {
          incident: structuredClone(observation.incident),
          incidentId: observation.incidentId,
        }),
    snapshot,
  } as HealthObservation
}

function stateMetadata(def: HealthCheckDef) {
  return {
    checkId: def.id,
    checkName: def.name,
    description: def.description,
    owner: { ...def.owner },
    group: { ...def.group },
    ...(def.maxAgeMs === undefined ? {} : { maxAgeMs: def.maxAgeMs }),
  }
}

function bump(): void {
  revision += 1
  // Cache or registry changes already own this revision. The first projection
  // from the new state establishes its time-derived baseline without a second
  // bump; later freshness-boundary changes advance independently.
  lastPublishedProjection = null
  if (listeners.size === 0) return
  const report = getHealthReport()
  for (const listener of listeners) listener(report)
}

onHealthRegistryChanged((removedCheckIds) => {
  for (const id of removedCheckIds) cache.delete(id)
  bump()
})

export function onHealthReportChanged(listener: (report: HealthReport) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyHealthCheckRun(run: DetailedHealthCheckRun): void {
  const previous = cache.get(run.def.id)
  const state: HealthCheckState = {
    ...stateMetadata(run.def),
    latestExecution: { ...run.execution, ...(run.execution.error ? { error: { ...run.execution.error } } : {}) },
  }

  if (run.execution.outcome === 'observed') {
    state.latestValidSnapshot = {
      executionId: run.execution.id,
      observations: run.observations.map((observation) => cloneObservation(observation, 'current')),
    }
  } else if (run.execution.outcome !== 'not_applicable' && previous?.state.latestValidSnapshot) {
    state.latestValidSnapshot = {
      executionId: previous.state.latestValidSnapshot.executionId,
      observations: previous.state.latestValidSnapshot.observations.map((observation) =>
        cloneObservation(observation, 'last_known'),
      ),
    }
  }

  cache.set(run.def.id, {
    state,
    ...(run.execution.outcome === 'not_applicable' ? { notApplicableStaleAt: run.freshUntil } : {}),
    latestAttemptObservations: run.execution.outcome === 'failed' || run.execution.outcome === 'invalid'
      ? run.observations.map((observation) => cloneObservation(observation, 'current'))
      : [],
  })
  bump()
}

export function applyHealthCheckRuns(runs: readonly DetailedHealthCheckRun[]): void {
  for (const run of runs) applyHealthCheckRun(run)
}

export function setLastFullHealthSweep(sweep: HealthFullSweep): void {
  lastFullSweep = { ...sweep }
  bump()
}

function transientExecution(
  def: HealthCheckDef,
  generatedAt: string,
  code: string,
  message: string,
): HealthCheckExecution {
  return {
    id: `${code.toLowerCase()}:${def.id}`,
    checkId: def.id,
    startedAt: generatedAt,
    completedAt: generatedAt,
    outcome: 'failed',
    error: { code, message },
  }
}

function verificationObservation(
  def: HealthCheckDef,
  generatedAt: string,
  kind: 'missing' | 'stale' | 'conflict',
  detail: string,
): HealthObservation {
  const key = `verification.${kind}`
  return {
    id: `${def.id}:${key}`,
    key,
    status: 'unknown',
    summary: `${def.name} is ${kind === 'stale' ? 'stale' : 'unverified'}.`,
    detail,
    checkId: def.id,
    checkName: def.name,
    owner: { kind: 'core', id: 'core', label: 'Bakin' },
    group: { key: 'verification', label: 'Verification' },
    checkedAt: generatedAt,
    observedAt: generatedAt,
    staleAt: generatedAt,
    snapshot: 'current',
    incidentId: `core:verification:${kind}:${def.id}`,
    incident: {
      key: `${kind}:${def.id}`,
      title: `${def.name} ${kind === 'stale' ? 'evidence is stale' : 'could not be verified'}`,
      impact: kind === 'stale'
        ? 'Bakin cannot currently confirm whether this part of the system is healthy.'
        : 'Bakin cannot currently confirm whether this part of the system is healthy. No evidence has been produced yet — run checks to gather it.',
      disposition: 'watch',
      resources: [{ kind: def.owner.kind === 'plugin' ? 'plugin' : 'other', id: def.owner.id, label: def.owner.label }],
      resolution: { key: 'rerun-check', type: 'rerun', label: 'Check again' },
    },
  }
}

function projectCheck(
  def: HealthCheckDef,
  generatedAt: string,
): { state: HealthCheckState; observations: HealthObservation[] } {
  const cached = cache.get(def.id)
  if (!cached) {
    return {
      state: {
        ...stateMetadata(def),
        latestExecution: transientExecution(
          def,
          generatedAt,
          'MISSING_HEALTH_EXECUTION',
          'This registered check has not completed yet.',
        ),
      },
      observations: [verificationObservation(def, generatedAt, 'missing', 'This registered check has not completed yet.')],
    }
  }

  const state: HealthCheckState = {
    ...cached.state,
    owner: { ...cached.state.owner },
    group: { ...cached.state.group },
    latestExecution: {
      ...cached.state.latestExecution,
      ...(cached.state.latestExecution.error ? { error: { ...cached.state.latestExecution.error } } : {}),
    },
  }
  const observations: HealthObservation[] = []
  const snapshot = cached.state.latestValidSnapshot
  if (snapshot) {
    const projected = snapshot.observations.map((observation) =>
      cloneObservation(
        observation,
        cached.state.latestExecution.outcome === 'observed'
          && Date.parse(observation.staleAt) > Date.parse(generatedAt)
          ? 'current'
          : 'last_known',
      ),
    )
    state.latestValidSnapshot = { executionId: snapshot.executionId, observations: projected }
    observations.push(...projected)
  }
  observations.push(...cached.latestAttemptObservations.map((observation) => cloneObservation(observation)))

  if (cached.state.latestExecution.outcome === 'observed' && snapshot
    && snapshot.observations.some((observation) => Date.parse(observation.staleAt) <= Date.parse(generatedAt))) {
    observations.push(verificationObservation(
      def,
      generatedAt,
      'stale',
      'The latest successful evidence is older than this check’s freshness window.',
    ))
  }
  if (cached.state.latestExecution.outcome === 'not_applicable'
    && cached.notApplicableStaleAt
    && Date.parse(cached.notApplicableStaleAt) <= Date.parse(generatedAt)) {
    observations.push(verificationObservation(
      def,
      generatedAt,
      'stale',
      'The latest not-applicable result is older than this check’s freshness window.',
    ))
  }
  return { state, observations }
}

function safeIncidentProjection(
  observations: readonly HealthObservation[],
  generatedAt: string,
  definitions: ReadonlyMap<string, HealthCheckDef>,
): { observations: HealthObservation[]; incidents: ReturnType<typeof buildHealthIncidents> } {
  const healthy = observations.filter((observation) => observation.status === 'healthy')
  const groups = new Map<string, HealthObservation[]>()
  for (const observation of observations) {
    if (observation.status === 'healthy') continue
    const current = groups.get(observation.incidentId) ?? []
    current.push(observation)
    groups.set(observation.incidentId, current)
  }

  const published: HealthObservation[] = [...healthy]
  const incidents: ReturnType<typeof buildHealthIncidents> = []
  const conflictDetailsByCheckId = new Map<string, Set<string>>()
  for (const rows of groups.values()) {
    try {
      incidents.push(...buildHealthIncidents(rows, generatedAt))
      published.push(...rows)
    } catch (error) {
      const detail = error instanceof Error
        ? error.message
        : 'Conflicting incident declarations were rejected.'
      const involvedCheckIds = [...new Set(rows.map((row) => row.checkId))].sort()
      for (const checkId of involvedCheckIds) {
        if (!definitions.has(checkId)) continue
        const details = conflictDetailsByCheckId.get(checkId) ?? new Set<string>()
        details.add(detail)
        conflictDetailsByCheckId.set(checkId, details)
      }
    }
  }
  for (const checkId of [...conflictDetailsByCheckId.keys()].sort()) {
    const def = definitions.get(checkId)
    if (!def) continue
    const replacement = verificationObservation(
      def,
      generatedAt,
      'conflict',
      [...conflictDetailsByCheckId.get(checkId)!].sort().join('; ').slice(0, 4_000),
    )
    published.push(replacement)
    incidents.push(...buildHealthIncidents([replacement], generatedAt))
  }
  return {
    observations: published.sort((a, b) =>
      a.group.key.localeCompare(b.group.key) || a.checkId.localeCompare(b.checkId) || a.id.localeCompare(b.id),
    ),
    incidents: sortHealthIncidents(incidents),
  }
}

/**
 * Identity of the report fields that may change solely as projection time
 * crosses an evidence freshness boundary. Synthetic projection timestamps
 * are excluded so repeated reads in the same state can reuse one immutable
 * report, including its original `generatedAt`.
 */
function semanticProjectionKey(report: Pick<
  HealthReport,
  'checks' | 'observations' | 'incidents' | 'overallStatus' | 'subsystems' | 'sensitivity'
>): string {
  return JSON.stringify({
    // Sensitivity participates in identity: a mode flip must republish even
    // when the underlying evidence is unchanged (no-restart flips, #690).
    sensitivity: report.sensitivity,
    checks: report.checks.map((check) => [
      check.checkId,
      check.latestValidSnapshot?.observations.map((observation) => [observation.id, observation.snapshot]) ?? [],
    ]),
    observations: report.observations.map((observation) => [
      observation.id,
      observation.status,
      observation.snapshot,
      observation.status === 'healthy' ? null : observation.incidentId,
    ]),
    incidents: report.incidents.map((incident) => [
      incident.id,
      incident.status,
      incident.disposition,
      incident.effectiveDisposition,
      incident.class ?? null,
      incident.stale,
      incident.observationIds,
      // Ack state participates in identity: ack writes and snooze expiry
      // republish without a doctor re-run (health trust overhaul).
      incident.ackState ?? null,
    ]),
    overallStatus: report.overallStatus,
    search: {
      status: report.subsystems.search.status,
      incidentIds: report.subsystems.search.incidentIds,
      stages: report.subsystems.search.stages.map((stage) => [stage.key, stage.status, stage.observationIds]),
    },
  })
}

/** Evidence identity for the any-change re-fire rule (action_required
 *  snoozes): a digest of the incident's linked observations' evidence. */
function incidentEvidenceSha(incident: HealthIncident, observationsById: Map<string, HealthObservation>): string {
  const payload = [...incident.observationIds].sort().map((id) => {
    const observation = observationsById.get(id)
    return [id, observation?.status ?? null, observation?.evidence ?? null]
  })
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/**
 * Join the user's ack/snooze records onto projected incidents. Invalid
 * records (expired snoozes, escalated acks, changed evidence) are pruned
 * lazily. A corrupt store FAILS OPEN toward visibility: acks are ignored,
 * everything re-surfaces, a warning logs — the user's attention is the
 * safe default for a health system.
 */
function applyIncidentAckStates(
  incidents: HealthIncident[],
  observations: HealthObservation[],
  generatedAt: string,
): HealthIncident[] {
  let records: Record<string, HealthAckRecord>
  try {
    records = readAckRecords()
  } catch (error) {
    log.warn('health ack store unreadable — acks ignored, all incidents re-surface', {
      err: error instanceof Error ? error.message : String(error),
    })
    return incidents
  }
  if (Object.keys(records).length === 0) return incidents

  const observationsById = new Map(observations.map((observation) => [observation.id, observation]))
  const nowMs = Date.parse(generatedAt)
  const invalidated: string[] = []
  // A record whose incident is ABSENT from the report means the incident
  // resolved (last-known retention keeps flapping checks alive, so absence
  // is evidence of resolution) — prune it, so a recurrence weeks later
  // arrives LOUD, not pre-silenced, and GET /doctor/acks never lists
  // ghost rows (review finding).
  const liveIds = new Set(incidents.map((incident) => incident.id))
  for (const recordId of Object.keys(records)) {
    if (!liveIds.has(recordId)) invalidated.push(recordId)
  }
  const joined = incidents.map((incident) => {
    const record = records[incident.id]
    if (!record) return incident
    const state = resolveAckState({
      record,
      effectiveDisposition: incident.effectiveDisposition as HealthAckTier,
      resourceFingerprint: resourceFingerprint(incident.resources),
      evidenceSha: incidentEvidenceSha(incident, observationsById),
      nowMs,
    })
    if (state === null) {
      invalidated.push(incident.id)
      return incident
    }
    return { ...incident, ackState: state }
  })
  pruneAckRecords(invalidated)
  return joined
}

/**
 * The ack/snooze verb. Validates against the CURRENT report (the incident
 * must exist; tier rules enforced with honest errors), writes the record,
 * and republishes immediately — no doctor re-run.
 */
export function acknowledgeHealthIncident(input: {
  incidentId: string
  action: 'ack' | 'snooze' | 'clear'
  forMs?: number
  now?: Date
}): { incidentId: string; action: 'ack' | 'snooze' | 'clear' } {
  const now = input.now ?? new Date()
  if (input.action === 'clear') {
    if (removeAckRecord(input.incidentId)) bump()
    return { incidentId: input.incidentId, action: 'clear' }
  }

  const report = getHealthReport(now.toISOString())
  const incident = report.incidents.find((candidate) => candidate.id === input.incidentId)
  if (!incident) {
    throw new HealthAckNotFoundError(`No current incident with id '${input.incidentId}'.`)
  }
  const tier = incident.effectiveDisposition as HealthAckTier
  const record: HealthAckRecord = {
    incidentId: incident.id,
    mode: input.action,
    at: now.toISOString(),
    tierAtAck: tier,
    resourceFingerprint: resourceFingerprint(incident.resources),
  }
  if (input.action === 'snooze') {
    const forMs = Math.min(input.forMs ?? 24 * 60 * 60 * 1000, SNOOZE_MAX_MS)
    record.until = new Date(now.getTime() + forMs).toISOString()
    if (tier === 'action_required') {
      const observationsById = new Map(report.observations.map((observation) => [observation.id, observation]))
      record.evidenceSha = incidentEvidenceSha(incident, observationsById)
    }
  }
  writeAckRecord(record)
  bump()
  return { incidentId: incident.id, action: input.action }
}

export function getHealthReport(generatedAt = new Date().toISOString()): HealthReport {
  const definitions = listHealthChecks()
  const defById = new Map(definitions.map((def) => [def.id, def]))
  const projected = definitions.map((def) => projectCheck(def, generatedAt))
  const checks = projected.map((entry) => entry.state)
  const candidateObservations = projected.flatMap((entry) => entry.observations)
  const { observations, incidents: rawIncidents } = safeIncidentProjection(candidateObservations, generatedAt, defById)
  // Sensitivity is applied HERE, once, before status derivation — every
  // consumer (UI, badge, escalation, CLI) reads the same effective story.
  // Ack state joins at the same ONE point: acked/snoozed incidents stay on
  // the wire (Acknowledged section) but stop driving attention anywhere.
  const sensitivity = getSettings().doctor.sensitivity
  const incidents = applyIncidentAckStates(
    sortHealthIncidents(projectEffectiveDispositions(rawIncidents, sensitivity)),
    observations,
    generatedAt,
  )
  const liveIncidents = incidents.filter((incident) => incident.ackState === undefined)
  const search = deriveSearchReadiness({ observations, incidents, checks, generatedAt })
  const overallStatus = deriveHealthReportStatus({
    registeredChecks: definitions.length,
    checks,
    incidents: liveIncidents,
  })
  const summary: HealthReport['summary'] = {
    checks: {
      registered: definitions.length,
      completed: checks.filter((check) =>
        check.latestExecution.outcome === 'observed' || check.latestExecution.outcome === 'not_applicable',
      ).length,
      failed: checks.filter((check) => check.latestExecution.outcome === 'failed').length,
      invalid: checks.filter((check) => check.latestExecution.outcome === 'invalid').length,
      notApplicable: checks.filter((check) => check.latestExecution.outcome === 'not_applicable').length,
    },
    incidents: {
      // Tier counts describe LIVE attention (they must reconcile with
      // overallStatus — review finding: acked incidents in the counts made
      // 'healthy: 1 action required' printable); acknowledged is explicit.
      actionRequired: liveIncidents.filter((incident) => incident.effectiveDisposition === 'action_required').length,
      watching: liveIncidents.filter((incident) => incident.effectiveDisposition === 'watch').length,
      advisory: liveIncidents.filter((incident) => incident.effectiveDisposition === 'advisory').length,
      unknown: liveIncidents.filter((incident) => incident.status === 'unknown').length,
      acknowledged: incidents.length - liveIncidents.length,
    },
  }
  const reportProjection = {
    overallStatus,
    sensitivity,
    checks,
    observations,
    incidents,
    subsystems: { search },
  }
  const projectionKey = semanticProjectionKey(reportProjection)
  if (lastPublishedProjection?.key === projectionKey) {
    return structuredClone(lastPublishedProjection.report)
  }

  const projectionChangedWithTime = lastPublishedProjection !== null
  if (projectionChangedWithTime) revision += 1

  const report: HealthReport = {
    id: `health-report-${revision}`,
    revision,
    generatedAt,
    lastFullSweep: lastFullSweep ? { ...lastFullSweep } : null,
    ...reportProjection,
    summary,
  }
  lastPublishedProjection = { key: projectionKey, report: structuredClone(report) }
  if (projectionChangedWithTime) {
    for (const listener of listeners) listener(structuredClone(report))
  }
  return structuredClone(report)
}

export function resetHealthReportCache(): void {
  cache.clear()
  revision = 0
  lastFullSweep = null
  lastPublishedProjection = null
}

export function getCachedHealthCheckState(checkId: string): HealthCheckState | undefined {
  return cache.get(checkId)?.state
}
