/**
 * The engine-side contract an update SOURCE implements (#1007, D7.1). One
 * source per subject kind; the engine owns scheduling, persistence, merging
 * and broadcasting — a source only enumerates subjects and observes one.
 *
 * Public record types live in `@makinbakin/sdk/types` (`updates.ts`).
 */
import type {
  UpdateAction,
  UpdateGroup,
  UpdateIdentity,
  UpdateOutcome,
  UpdateReason,
  UpdateSourceRef,
  UpdateSubject,
  UpdateSubjectKind,
} from '@makinbakin/sdk/types'

/** One subject a source currently knows about, with the fingerprint its observation depends on. */
export interface UpdateSubjectInventoryEntry {
  subject: UpdateSubject
  group: UpdateGroup
  /**
   * Hash of the installed identity + everything eligibility depends on
   * (host version, platform, externals contract, settings…). A change retires
   * the stored observation; a late observation carrying a stale one is dropped.
   */
  fingerprint: string
  source: UpdateSourceRef
}

/** What a successful observation says about a subject. Clocks and fingerprint are the engine's. */
export interface UpdateObservation {
  installed?: UpdateIdentity
  available?: UpdateIdentity
  reason?: UpdateReason
  outcome: UpdateOutcome
  action?: UpdateAction
  blockedReason?: string
  notesUrl?: string
  /** Override the inventory's source ref (e.g. the exact endpoint answered). */
  source?: UpdateSourceRef
}

/**
 * Conditional-request state, keyed by the normalized `endpoint + repo + ref`
 * (NEVER by source kind): an ETag + the validated representation for REST and
 * artifact indexes, the last remote sha for git refs — so a 304 after a
 * restart can reuse the matching body (D7.3, C12).
 */
export interface ConditionalEntry {
  etag?: string
  lastModified?: string
  body?: unknown
  sha?: string
  updatedAt: string
}

export interface ConditionalStore {
  get(key: string): ConditionalEntry | undefined
  set(key: string, entry: Omit<ConditionalEntry, 'updatedAt'>): void
}

export interface ObserveOptions {
  signal: AbortSignal
  conditional: ConditionalStore
}

export interface UpdateSource {
  kind: UpdateSubjectKind
  /** Every subject of this kind present on this installation, with current fingerprints. */
  inventory(): Promise<UpdateSubjectInventoryEntry[]>
  /** Observe one subject. Throw to record a failed attempt (the last good observation survives). */
  observe(entry: UpdateSubjectInventoryEntry, opts: ObserveOptions): Promise<UpdateObservation>
}

/**
 * A failed observation that knows when to try again (a 403/429 with
 * `Retry-After` / `X-RateLimit-Reset`): the engine's backoff never schedules
 * the next attempt before `retryAfterMs` has passed.
 */
export class UpdateCheckError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'UpdateCheckError'
  }
}

/** Per-subject scheduling state (D7.5). */
export interface UpdateScheduleEntry {
  lastCheckedAt?: string
  nextDueAt?: string
  /** Consecutive failed attempts; drives the backoff. */
  failures: number
}
