/**
 * Updates — the one record every "is there something newer / required" probe
 * produces (#1007). Health renders them, Explore/Team/the header/CLI read
 * them over HTTP, and the engine in `src/core/updates/` owns observation,
 * persistence (`~/.bakin/updates.json`) and scheduling.
 *
 * A record is an OBSERVATION with two clocks: `observedAt` is the last
 * SUCCESSFUL observation; `attempt` is the last attempt, success or not. A
 * failed attempt never overwrites a good observation; a subject with no
 * success yet is `unknown` with the error on `attempt`.
 *
 * Pure types + constants only (this module is published through
 * `@makinbakin/sdk/types`, which stays runtime-light); the zod schemas live
 * with the engine (`src/core/updates/schema.ts`).
 */

export const UPDATE_SUBJECT_KINDS = ['bakin', 'plugin', 'package', 'hub-skill', 'search-engine', 'search-models', 'gateway'] as const
export type UpdateSubjectKind = (typeof UPDATE_SUBJECT_KINDS)[number]

/** `required`: the installation cannot work as configured until this is applied. `available`: newer, optional. */
export const UPDATE_GROUPS = ['required', 'available'] as const
export type UpdateGroup = (typeof UPDATE_GROUPS)[number]

export const UPDATE_REASONS = ['newer-version', 'newer-commit', 'compatible-rebuild', 'pin-mismatch', 'below-floor'] as const
export type UpdateReason = (typeof UPDATE_REASONS)[number]

export const UPDATE_OUTCOMES = ['current', 'update-available', 'blocked', 'unsupported', 'unknown'] as const
export type UpdateOutcome = (typeof UPDATE_OUTCOMES)[number]

export const UPDATE_IMPACTS = ['server-restart', 'search-interruption', 'reindex', 'download'] as const
export type UpdateImpact = (typeof UPDATE_IMPACTS)[number]

/** What is installed or offered. At least one of version/sha/digest identifies it; `display` is for people. */
export interface UpdateIdentity {
  version?: string
  sha?: string
  digest?: string
  display: string
}

/** The identity a skip targets — the FULL available identity, so two same-version commits are two skips. */
export type UpdateSkipTarget = Pick<UpdateIdentity, 'version' | 'sha' | 'digest'>

export interface UpdateSubject {
  kind: UpdateSubjectKind
  /** Stable within the kind (plugin id, package id, 'antfly', 'bakin', …). */
  id: string
  label: string
}

export interface UpdateSourceRef {
  /** Which observer produced it (e.g. 'github-release', 'artifact-index', 'git-ref', 'adapter'). */
  kind: string
  /** Normalized endpoint (URL, repo, or adapter name) — what the record was observed from. */
  endpoint: string
  ref?: string
}

export type UpdateAction =
  | {
      kind: 'operation'
      /** Starts the subject's existing flow; the server re-validates — a record is never authorization. */
      start: { route: string; body?: Record<string, unknown> }
      impact: UpdateImpact[]
      downloadBytes?: number
    }
  | { kind: 'manual'; pointer: string }

export interface UpdateAttempt {
  /** ISO instant of the last attempt. */
  at: string
  /** Present when that attempt failed. */
  error?: string
}

export interface UpdateRecord {
  /** `<kind>:<subjectId>`. */
  id: string
  group: UpdateGroup
  subject: UpdateSubject
  installed?: UpdateIdentity
  available?: UpdateIdentity
  reason?: UpdateReason
  outcome: UpdateOutcome
  source: UpdateSourceRef
  /** ISO instant of the last SUCCESSFUL observation. Absent until one succeeds. */
  observedAt?: string
  /** The last attempt, successful or not. Absent before the first attempt. */
  attempt?: UpdateAttempt
  /** Hash of the subject's installed identity + everything its eligibility depends on; a mismatch retires the observation. */
  fingerprint: string
  action?: UpdateAction
  /** Why `outcome` is `blocked` or `unsupported`, for people. */
  blockedReason?: string
  notesUrl?: string
  /** The available identity the operator chose to hide. Cleared whenever the available identity changes. */
  skipped?: UpdateSkipTarget
}

export interface UpdatesSnapshot {
  records: UpdateRecord[]
  /** ISO instant the snapshot was taken. */
  generatedAt: string
  /** True while a check pass is running. */
  running: boolean
}

/** The comparable part of an identity: version, sha and digest — never the display string. */
export function updateIdentityKey(identity: UpdateSkipTarget | undefined): string | null {
  if (!identity) return null
  const parts = [identity.version ?? '', identity.sha ?? '', identity.digest ?? '']
  return parts.every((part) => part === '') ? null : parts.join('\u0000')
}

/** True when the record's current available identity is the one the operator skipped. */
export function isUpdateSkipped(record: Pick<UpdateRecord, 'available' | 'skipped'>): boolean {
  const skipped = updateIdentityKey(record.skipped)
  return skipped !== null && skipped === updateIdentityKey(record.available)
}

/** True when the record offers an update the operator has not skipped — the ONE predicate every badge, count and projection uses. */
export function isUpdateOffered(record: Pick<UpdateRecord, 'outcome' | 'available' | 'skipped'>): boolean {
  return record.outcome === 'update-available' && !isUpdateSkipped(record)
}

/** Days since the last successful observation when older than `thresholdDays`, else null (a staleness hint, never a verdict). */
export function updateStaleDays(observedAt: string | null | undefined, now = Date.now(), thresholdDays = 7): number | null {
  if (!observedAt) return null
  const days = Math.floor((now - Date.parse(observedAt)) / (24 * 60 * 60 * 1000))
  return Number.isFinite(days) && days > thresholdDays ? days : null
}

/** The count the Updates tab label carries: available, not skipped. */
export function countAvailableUpdates(records: ReadonlyArray<UpdateRecord>): number {
  return records.filter(isUpdateOffered).length
}
