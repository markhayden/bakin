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

function clampCopy<T extends { summary: string; detail?: string; incident?: { impact: string } }>(input: T): T {
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
  if (clamped.incident && clamped.incident.impact.length > IMPACT_MAX) {
    clamped.incident = { ...clamped.incident, impact: truncate(clamped.incident.impact, IMPACT_MAX) }
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
