/** Canonical validating Health runner. */
import type {
  HealthCheckDef,
  HealthCheckExecution,
  HealthIncidentInput,
  HealthObservation,
  HealthObservationInput,
  HealthOwner,
} from '../../packages/core/src/plugin-types'
import { safeParseHealthCheckRunInput } from './health-contract'
import { getHealthRepairAction, listHealthChecks } from './health-check-registry'

export interface DetailedHealthCheckRun {
  def: HealthCheckDef
  execution: HealthCheckExecution
  /** Expiry of an execution-level result such as not_applicable. */
  freshUntil: string
  /** Current observed snapshot, or one core-owned verification observation on failure. */
  observations: HealthObservation[]
}

export interface HealthCheckRunOptions {
  defaultMaxAgeMs?: number
  now?: () => Date
  executionId?: () => string
}

const CORE_OWNER: HealthOwner = { kind: 'core', id: 'core', label: 'Bakin' }
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function graceMs(ttlMs: number): number {
  return Math.min(5 * 60_000, Math.max(60_000, ttlMs * 0.2))
}

function staleAt(observedAt: string, ttlMs: number): string {
  return new Date(Date.parse(observedAt) + ttlMs + graceMs(ttlMs)).toISOString()
}

function namespaceRepairAction(owner: HealthOwner, incident: HealthIncidentInput): HealthIncidentInput {
  if (incident.resolution.type !== 'repair') return incident
  const localOrCanonical = incident.resolution.actionId
  const actionId = localOrCanonical.startsWith(`${owner.id}.`)
    ? localOrCanonical
    : `${owner.id}.${localOrCanonical}`
  const action = getHealthRepairAction(actionId)
  if (!action || action.owner.kind !== owner.kind || action.owner.id !== owner.id) {
    throw new Error(`Repair action reference is not registered for owner ${owner.id}`)
  }
  return {
    ...incident,
    resolution: { ...incident.resolution, actionId },
  }
}

function stampObservation(
  def: HealthCheckDef,
  input: HealthObservationInput,
  checkedAt: string,
  ttlMs: number,
): HealthObservation {
  const observedAt = input.sourceObservedAt ?? checkedAt
  const base = {
    ...input,
    id: `${def.id}:${input.key}`,
    checkId: def.id,
    checkName: def.name,
    owner: { ...def.owner },
    group: { ...def.group },
    checkedAt,
    observedAt,
    staleAt: staleAt(observedAt, ttlMs),
    snapshot: 'current' as const,
  }
  if (input.status === 'healthy') return base as HealthObservation
  const incident = namespaceRepairAction(def.owner, input.incident)
  return {
    ...base,
    incident,
    incidentId: `${def.owner.id}:${def.group.key}:${incident.key}`,
  } as HealthObservation
}

function verificationObservation(
  def: HealthCheckDef,
  checkedAt: string,
  ttlMs: number,
  reason: string,
): HealthObservation {
  const incidentId = `core:verification:${def.id}`
  return {
    id: `${def.id}:verification`,
    key: 'verification',
    status: 'unknown',
    summary: `Unable to verify ${def.name}.`,
    detail: reason,
    checkId: def.id,
    checkName: def.name,
    owner: CORE_OWNER,
    group: { key: 'verification', label: 'Verification' },
    checkedAt,
    observedAt: checkedAt,
    staleAt: staleAt(checkedAt, ttlMs),
    snapshot: 'current',
    incidentId,
    incident: {
      key: def.id,
      title: `${def.name} could not be verified`,
      impact: 'Bakin cannot currently confirm whether this part of the system is healthy.',
      disposition: 'watch',
      resources: [{ kind: 'plugin', id: def.owner.id, label: def.owner.label }],
      resolution: { key: 'rerun-check', type: 'rerun', label: 'Check again' },
    },
  }
}

export async function runHealthCheck(
  def: HealthCheckDef,
  options: HealthCheckRunOptions = {},
): Promise<DetailedHealthCheckRun> {
  const now = options.now ?? (() => new Date())
  const makeExecutionId = options.executionId ?? (() => `execution-${crypto.randomUUID()}`)
  const startedAt = now().toISOString()
  const ttlMs = def.maxAgeMs ?? options.defaultMaxAgeMs ?? DEFAULT_MAX_AGE_MS

  try {
    const raw = await def.run()
    const completedAt = now().toISOString()
    const parsed = safeParseHealthCheckRunInput(raw)
    if (!parsed.success) {
      return {
        def,
        freshUntil: staleAt(completedAt, ttlMs),
        execution: {
          id: makeExecutionId(),
          checkId: def.id,
          startedAt,
          completedAt,
          outcome: 'invalid',
          error: { code: parsed.error.code, message: parsed.error.message },
        },
        observations: [verificationObservation(def, completedAt, ttlMs, parsed.error.message)],
      }
    }

    if (parsed.data.outcome === 'not_applicable') {
      return {
        def,
        freshUntil: staleAt(completedAt, ttlMs),
        execution: {
          id: makeExecutionId(),
          checkId: def.id,
          startedAt,
          completedAt,
          outcome: 'not_applicable',
          reason: parsed.data.reason,
        },
        observations: [],
      }
    }

    try {
      return {
        def,
        freshUntil: staleAt(completedAt, ttlMs),
        execution: {
          id: makeExecutionId(),
          checkId: def.id,
          startedAt,
          completedAt,
          outcome: 'observed',
        },
        observations: parsed.data.observations.map((observation) =>
          stampObservation(def, observation, completedAt, ttlMs),
        ),
      }
    } catch (error) {
      const message = errorMessage(error)
      return {
        def,
        freshUntil: staleAt(completedAt, ttlMs),
        execution: {
          id: makeExecutionId(),
          checkId: def.id,
          startedAt,
          completedAt,
          outcome: 'invalid',
          error: { code: 'INVALID_HEALTH_REFERENCE', message },
        },
        observations: [verificationObservation(def, completedAt, ttlMs, message)],
      }
    }
  } catch (error) {
    const completedAt = now().toISOString()
    const message = errorMessage(error)
    return {
      def,
      freshUntil: staleAt(completedAt, ttlMs),
      execution: {
        id: makeExecutionId(),
        checkId: def.id,
        startedAt,
        completedAt,
        outcome: 'failed',
        error: { code: 'HEALTH_CHECK_FAILED', message },
      },
      observations: [verificationObservation(def, completedAt, ttlMs, message)],
    }
  }
}

export async function runDetailedPluginHealthChecks(
  options: HealthCheckRunOptions = {},
): Promise<DetailedHealthCheckRun[]> {
  return Promise.all(listHealthChecks().map((def) => runHealthCheck(def, options)))
}

/** Canonical observations from one full execution pass. */
export async function runPluginHealthChecks(
  options: HealthCheckRunOptions = {},
): Promise<HealthObservation[]> {
  const groups = await runDetailedPluginHealthChecks(options)
  return groups.flatMap((group) => group.observations)
}
