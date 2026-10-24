/** Canonical validating Health runner. */
import type {
  HealthCheckDef,
  HealthCheckExecution,
  HealthIncidentDeclaration,
  HealthIncidentInput,
  HealthObservation,
  HealthObservationInput,
  HealthOwner,
  HealthSubject,
} from '../../packages/core/src/plugin-types'
import { SHARED_ENGINE_ACTIONS } from '@bakin/core/health/authorize-mutation'
import { safeParseHealthCheckRunInput } from './health-contract'
import { getHealthRepairAction, listHealthChecks, resolveDeclaredRepairAction } from './health-check-registry'
import { createLogger } from './logger'

const log = createLogger('doctor-checks')

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
  /** Maximum time a check may run before it is reported as Unknown. */
  timeoutMs?: number
  /** Internal lifecycle hook used to keep retries from overlapping timed-out work. */
  onWorkSettled?: (settled: Promise<void>) => void
  now?: () => Date
  executionId?: () => string
}

const CORE_OWNER: HealthOwner = { kind: 'core', id: 'core', label: 'Bakin' }
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 30_000
const MAX_TIMER_MS = 2_147_483_647

class HealthCheckTimeoutError extends Error {
  constructor(readonly timeoutMs: number, checkName: string) {
    super(`Health check "${checkName}" timed out after ${timeoutMs.toLocaleString('en-US')} ms.`)
    this.name = 'HealthCheckTimeoutError'
  }
}

function boundedTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_HEALTH_CHECK_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HEALTH_CHECK_TIMEOUT_MS
  return Math.min(MAX_TIMER_MS, Math.max(1, Math.floor(value)))
}

async function withCheckTimeout<T>(
  work: Promise<T>,
  checkName: string,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new HealthCheckTimeoutError(timeoutMs, checkName)
          reject(error)
          controller.abort(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function graceMs(ttlMs: number): number {
  return Math.min(5 * 60_000, Math.max(60_000, ttlMs * 0.2))
}

function staleAt(observedAt: string, ttlMs: number): string {
  return new Date(Date.parse(observedAt) + ttlMs + graceMs(ttlMs)).toISOString()
}

/** An emitted instance that contradicts its declared family (self-healing 1.5). */
class HealthDeclarationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HealthDeclarationError'
  }
}

function describeResolution(resolution: HealthIncidentInput['resolution']): string {
  return resolution.type === 'repair' ? `repair "${resolution.actionId}"` : `human (${resolution.needs})`
}

/** The subject a check OWNER stands for when core speaks about the check itself (verification rows). */
export function ownerSubject(owner: HealthOwner): HealthSubject {
  return { kind: owner.kind === 'plugin' ? 'plugin' : owner.kind === 'adapter' ? 'runtime' : 'system', id: owner.id, label: owner.label }
}

function findDeclaration(def: HealthCheckDef, incident: HealthIncidentInput): HealthIncidentDeclaration {
  const declaration = def.incidents.find((entry) => entry.id === incident.declarationId)
  if (!declaration) {
    throw new HealthDeclarationError(`Incident "${incident.key}" names declaration "${incident.declarationId}", which check ${def.id} does not declare.`)
  }
  return declaration
}

/**
 * An instance must match its declared family: a repair family's action
 * (canonical), or a human family's `needs`. `required` is derived from the
 * family (`always` / `never`) or carried by the instance (`owner-decides`,
 * mandatory). Returns the canonical incident with `required` resolved.
 */
function assertDeclaredInstance(def: HealthCheckDef, incident: HealthIncidentInput): HealthIncidentInput & { required: boolean } {
  const declaration = findDeclaration(def, incident)
  const resolution = incident.resolution
  if (declaration.resolution.type === 'repair') {
    const declared = resolveDeclaredRepairAction(def.owner, declaration.resolution.actionId) ?? declaration.resolution.actionId
    if (resolution.type !== 'repair' || resolution.actionId !== declared) {
      throw new HealthDeclarationError(`Incident "${incident.key}" is declared as repair "${declared}" but was emitted as ${describeResolution(resolution)}.`)
    }
  } else if (resolution.type !== 'human' || resolution.needs !== declaration.resolution.needs) {
    throw new HealthDeclarationError(`Incident "${incident.key}" is declared as a human need (${declaration.resolution.needs}) but was emitted as ${describeResolution(resolution)}.`)
  }
  let required: boolean
  if (declaration.required === 'owner-decides') {
    if (typeof incident.required !== 'boolean') {
      throw new HealthDeclarationError(`Incident "${incident.key}" belongs to the owner-decides family "${declaration.id}" but carries no \`required\` verdict.`)
    }
    required = incident.required
  } else {
    required = declaration.required === 'always'
  }
  return { ...incident, required }
}

function namespaceRepairAction(owner: HealthOwner, incident: HealthIncidentInput): HealthIncidentInput {
  if (incident.resolution.type !== 'repair') return incident
  const localOrCanonical = incident.resolution.actionId
  // A shared engine action (`core.diagnose`) is referenced verbatim by every owner.
  if (SHARED_ENGINE_ACTIONS.includes(localOrCanonical)) return incident
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
  if (input.status === 'healthy' || !input.incident) return base as HealthObservation
  const incident = assertDeclaredInstance(def, namespaceRepairAction(def.owner, input.incident))
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
      // This card means the CHECK ITSELF failed to produce evidence (it
      // crashed or timed out). The error goes INTO the card copy — the
      // first version told operators to "expand this card" for a detail
      // the incident view never rendered (field feedback, 2026-07-22:
      // instructions must reference what is actually on screen).
      impact: `Bakin cannot currently confirm whether this part of the system is healthy — the check crashed instead of reporting evidence. Error: ${reason.slice(0, 300)}`,
      disposition: 'watch',
      // The check OWNER's subject (re-homing row 206): a crashed check is
      // the fallback lane's business, never a human's — `core.diagnose`
      // investigates it once the engine's bound (spec §3.1) is reached.
      subject: ownerSubject(def.owner),
      declarationId: 'verification',
      required: false,
      resources: [{ kind: 'plugin', id: def.owner.id, label: def.owner.label }],
      resolution: {
        key: 'diagnose-check-failure',
        type: 'repair',
        label: 'Investigate the failed check',
        actionId: 'core.diagnose',
      },
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
  const timeoutMs = boundedTimeoutMs(def.timeoutMs ?? options.timeoutMs)
  const controller = new AbortController()
  const work = Promise.resolve().then(() => def.run({ signal: controller.signal }))
  options.onWorkSettled?.(work.then(() => undefined, () => undefined))

  try {
    const raw = await withCheckTimeout(work, def.name, timeoutMs, controller)
    const completedAt = now().toISOString()
    const parsed = safeParseHealthCheckRunInput(raw)
    if (!parsed.success) {
      // Surface the structured issues — the bare contract message hid the
      // failing field paths from the card, the log, AND the execution
      // record, leaving a field diagnosis stuck at "failed validation"
      // with nothing to act on (2026-07-22).
      const issueText = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      const reason = issueText ? `${parsed.error.message} ${issueText}` : parsed.error.message
      log.warn('health check output failed contract validation', {
        checkId: def.id,
        issues: parsed.error.issues.slice(0, 10),
      })
      return {
        def,
        freshUntil: staleAt(completedAt, ttlMs),
        execution: {
          id: makeExecutionId(),
          checkId: def.id,
          startedAt,
          completedAt,
          outcome: 'invalid',
          error: { code: parsed.error.code, message: reason },
        },
        observations: [verificationObservation(def, completedAt, ttlMs, reason)],
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
          error: { code: error instanceof HealthDeclarationError ? 'INVALID_HEALTH_DECLARATION' : 'INVALID_HEALTH_REFERENCE', message },
        },
        observations: [verificationObservation(def, completedAt, ttlMs, message)],
      }
    }
  } catch (error) {
    const completedAt = now().toISOString()
    const message = errorMessage(error)
    const code = error instanceof HealthCheckTimeoutError
      ? 'HEALTH_CHECK_TIMEOUT'
      : 'HEALTH_CHECK_FAILED'
    return {
      def,
      freshUntil: staleAt(completedAt, ttlMs),
      execution: {
        id: makeExecutionId(),
        checkId: def.id,
        startedAt,
        completedAt,
        outcome: 'failed',
        error: { code, message },
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
