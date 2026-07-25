/**
 * Health observation builders — the ONE construction path for check
 * output, shared by plugins (via `@makinbakin/sdk/utils`, which
 * re-exports these) and adapter packages (which depend only on
 * `@bakin/core`).
 *
 * The builders CLAMP copy to the health contract's bounds instead of
 * letting an overlong or blank string invalidate the whole run: a check
 * that interpolated a long runtime error into its summary used to fail
 * contract validation wholesale, turning real evidence into a useless
 * "could not be verified" card (field-diagnosed 2026-07-22). Truncated
 * copy is honest; discarded evidence is not. Constructing observations
 * as raw object literals bypasses this protection — always build through
 * these helpers.
 */
import type {
  ErrorObservationInput,
  HealthNonEmptyArray,
  HealthObservationInput,
  HealthyObservationInput,
  NotApplicableHealthCheckRunInput,
  ObservedHealthCheckRunInput,
  UnknownObservationInput,
  WarningObservationInput,
} from '../plugin-types'

type HealthyObservationFields = Omit<HealthyObservationInput, 'status'>
type WarningObservationFields = Omit<WarningObservationInput, 'status'>
type ErrorObservationFields = Omit<ErrorObservationInput, 'status'>
type UnknownObservationFields = Omit<UnknownObservationInput, 'status'>

// Bounds mirror health-contract.ts (observation summary/detail + incident impact).
const SUMMARY_MAX = 500
const DETAIL_MAX = 4_000
const IMPACT_MAX = 500

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  let end = max - 1
  // Never split a surrogate pair — a lone high surrogate renders as U+FFFD.
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${value.slice(0, end)}…`
}

const RESOURCE_LABEL_MAX = 120
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/

type ResourceLike = { id: string; label?: string }

function normalizeResources<R extends ResourceLike>(resources: R[]): R[] {
  return resources.map((resource) => {
    const next = { ...resource }
    // Deterministic sanitize is identity on already-valid ids — only
    // contract-invalid ids (a filesystem path, uppercase, slashes) change.
    if (!STABLE_ID_PATTERN.test(next.id)) next.id = healthResourceId(next.id)
    if (next.label !== undefined) {
      const label = next.label.trim()
      if (label.length === 0) delete next.label
      else next.label = truncate(label, RESOURCE_LABEL_MAX)
    }
    return next
  })
}

function clampCopy<T extends { summary: string; detail?: string; incident?: { impact: string; resources?: ResourceLike[] } }>(input: T): T {
  const clamped = { ...input }
  const summary = clamped.summary.trim()
  clamped.summary = truncate(summary.length > 0 ? summary : '(no summary provided)', SUMMARY_MAX)
  if (clamped.detail !== undefined) {
    const detail = clamped.detail.trim()
    if (detail.length === 0) {
      delete clamped.detail
    } else {
      clamped.detail = truncate(detail, DETAIL_MAX)
    }
  }
  if (clamped.incident) {
    const incident = { ...clamped.incident }
    if (incident.impact.length > IMPACT_MAX) incident.impact = truncate(incident.impact, IMPACT_MAX)
    if (incident.resources) incident.resources = normalizeResources(incident.resources)
    clamped.incident = incident
  }
  return clamped
}

/** Build a healthy observation. Healthy observations cannot carry incidents. */
export function healthHealthy(input: HealthyObservationFields): HealthyObservationInput {
  return { ...clampCopy(input), status: 'healthy' }
}

/** Build a warning observation with an explicit advisory/watch/action disposition. */
export function healthWarning(input: WarningObservationFields): WarningObservationInput {
  return { ...clampCopy(input), status: 'warning' }
}

/** Build an error observation. Its incident must require operator action. */
export function healthError(input: ErrorObservationFields): ErrorObservationInput {
  return { ...clampCopy(input), status: 'error' }
}

/** Build an Unknown verification observation (watch, or advisory when it self-resolves). */
export function healthUnknown(input: UnknownObservationFields): UnknownObservationInput {
  return { ...clampCopy(input), status: 'unknown' }
}

/** Build a successful observed run. Empty diagnostic output is unrepresentable. */
export function healthObserved(
  observations: HealthNonEmptyArray<HealthObservationInput>,
): ObservedHealthCheckRunInput {
  return { outcome: 'observed', observations }
}

/** Build an explicit successful not-applicable run. */
export function healthNotApplicable(reason: string): NotApplicableHealthCheckRunInput {
  return { outcome: 'not_applicable', reason }
}

/**
 * Deterministically coerce arbitrary text (a filesystem path, a table
 * name, a task id) into the contract's stable resource-id format
 * (`^[a-z0-9][a-z0-9._:-]{0,127}$`). A raw path used as a resource id
 * failed contract validation and nuked a REAL finding into a generic
 * "could not be verified" card for three releases (field-diagnosed
 * 2026-07-23). Put the human-readable original in `label`, never in `id`.
 */
export function healthResourceId(raw: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 128)
  return sanitized.length > 0 ? sanitized : 'unknown'
}
