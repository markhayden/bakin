/**
 * Health incident acknowledge/snooze store — the "I know" verb (health
 * trust overhaul, 2026-07-24).
 *
 * ONE flat JSON file (~/.bakin/health/acks.json), ONE re-fire comparison
 * (resolveAckState). Tiered semantics: advisory/watch/unknown incidents
 * may be acked (silent until material change) or snoozed; action_required
 * is snooze-only (max 7 days) and re-fires on ANY evidence change — money
 * and outages are never permanently silenceable.
 *
 * Ack state joins the health report in getHealthReport (the same ONE
 * projection point as sensitivity); consumers filter on the projected
 * `ackState`, never re-derive. Suppressed is not deleted: the overview
 * renders acked incidents in an always-visible Acknowledged section.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getBakinPaths } from './content-dir'

export type HealthAckTier = 'advisory' | 'watch' | 'action_required'
export type HealthAckMode = 'ack' | 'snooze'

export interface HealthAckRecord {
  incidentId: string
  mode: HealthAckMode
  /** ISO timestamp of the user action. */
  at: string
  /** ISO expiry — required for snooze, absent for ack. */
  until?: string
  /** Effective tier when the user acted; escalation past it re-fires. */
  tierAtAck: HealthAckTier
  /** Order-independent fingerprint of the incident's resource set. */
  resourceFingerprint: string
  /** action_required snoozes only: any evidence change re-fires. */
  evidenceSha?: string
}

export class HealthAckStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'HealthAckStoreError'
    this.cause = cause
  }
}

/** Typed not-found (unknown incident id) — consumers branch on the TYPE,
 *  never on message text (adapter-boundary architecture rule). */
export class HealthAckNotFoundError extends HealthAckStoreError {
  constructor(message: string) {
    super(message)
    this.name = 'HealthAckNotFoundError'
  }
}

export const SNOOZE_MAX_MS = 7 * 24 * 60 * 60 * 1000

const TIER_ORDER: Record<HealthAckTier, number> = {
  advisory: 0,
  watch: 1,
  action_required: 2,
}

export function acksPath(): string {
  return join(getBakinPaths().home, 'health', 'acks.json')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}

const TIERS = new Set<string>(['advisory', 'watch', 'action_required'])

/**
 * The ONE rule set for a stored record, applied on write AND on read (#898):
 * the file is a plain JSON file anything running as this user can write, so
 * a record suppresses an incident only if it is a record the ack verb could
 * have written. Returns why the record is invalid, or null.
 */
export function ackRecordProblem(key: string, value: unknown, nowMs: number): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not a record'
  const record = value as Partial<Record<keyof HealthAckRecord, unknown>>
  if (typeof record.incidentId !== 'string' || record.incidentId === '') return 'missing incidentId'
  if (record.incidentId !== key) return `keyed as '${key}' but names incident '${record.incidentId}'`
  if (record.mode !== 'ack' && record.mode !== 'snooze') return 'unknown mode'
  if (typeof record.tierAtAck !== 'string' || !TIERS.has(record.tierAtAck)) return 'unknown tierAtAck'
  if (typeof record.resourceFingerprint !== 'string') return 'missing resourceFingerprint'
  if (record.evidenceSha !== undefined && typeof record.evidenceSha !== 'string') return 'evidenceSha is not a string'
  if (record.until !== undefined && typeof record.until !== 'string') return 'until is not a string'
  const atMs = typeof record.at === 'string' ? Date.parse(record.at) : Number.NaN
  if (!Number.isFinite(atMs)) return 'at is not a valid time'
  if (atMs > nowMs) return 'at is in the future'
  if (record.mode === 'ack') {
    if (record.tierAtAck === 'action_required') return 'action_required incidents cannot be permanently acknowledged — snooze only'
    return null
  }
  if (typeof record.until !== 'string') return 'snooze without an expiry'
  const window = Date.parse(record.until) - atMs
  if (!Number.isFinite(window) || window <= 0 || window > SNOOZE_MAX_MS) return 'snooze window is not between 0 and 7 days'
  if (record.tierAtAck === 'action_required' && !record.evidenceSha) return 'action_required snooze without evidenceSha'
  return null
}

export interface InvalidAckRecord {
  /** The key the record is stored under. */
  key: string
  reason: string
}

/** Raw entries as stored. Missing file = empty; corrupt file = typed error
 *  the projection surfaces — never a crash, never a silent reset that
 *  would lose the user's acks. */
function readRawEntries(): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(acksPath(), 'utf-8')
  } catch (error) {
    if (isMissingFileError(error)) return {}
    throw new HealthAckStoreError('Health ack store could not be read.', error)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new HealthAckStoreError('Health ack store is invalid JSON.', error)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HealthAckStoreError('Health ack store has an invalid shape.')
  }
  return parsed as Record<string, unknown>
}

/** Valid records plus the ones that fail the write rules. Invalid records
 *  suppress nothing; they stay in the file (writes and prunes never drop
 *  them) until `clear` removes them, so the health check can name them. */
export function inspectAckStore(nowMs = Date.now()): { records: Record<string, HealthAckRecord>; invalid: InvalidAckRecord[] } {
  const records: Record<string, HealthAckRecord> = {}
  const invalid: InvalidAckRecord[] = []
  for (const [key, value] of Object.entries(readRawEntries())) {
    const reason = ackRecordProblem(key, value, nowMs)
    if (reason === null) records[key] = value as HealthAckRecord
    else invalid.push({ key, reason })
  }
  return { records, invalid }
}

/** The records that may suppress an incident. */
export function readAckRecords(nowMs = Date.now()): Record<string, HealthAckRecord> {
  return inspectAckStore(nowMs).records
}

function writeAll(records: Record<string, unknown>): void {
  const path = acksPath()
  mkdirSync(dirname(path), { recursive: true })
  // Temp+rename: a crash mid-write must not corrupt the store (a corrupt
  // store fails open loudly, but the user's acks would be lost).
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(records, null, 2))
  renameSync(tmp, path)
}

/** Validates with the read rules at the storage boundary (defense in
 *  depth — the REST route re-validates with honest HTTP errors). */
export function writeAckRecord(record: HealthAckRecord, nowMs = Date.now()): void {
  const problem = ackRecordProblem(record.incidentId, record, nowMs)
  if (problem !== null) throw new HealthAckStoreError(`Invalid health ack: ${problem}.`)
  const records = readRawEntries()
  records[record.incidentId] = record
  writeAll(records)
}

export function removeAckRecord(incidentId: string): boolean {
  const records = readRawEntries()
  if (!(incidentId in records)) return false
  delete records[incidentId]
  writeAll(records)
  return true
}

/** Lazy prune for records invalidated at projection time (expired snoozes,
 *  escalated acks, resolved incidents). Best-effort: pruning never throws
 *  into the projection. */
export function pruneAckRecords(incidentIds: string[]): void {
  if (incidentIds.length === 0) return
  try {
    const records = readRawEntries()
    let changed = false
    for (const id of incidentIds) {
      if (id in records) {
        delete records[id]
        changed = true
      }
    }
    if (changed) writeAll(records)
  } catch {
    // The projection already surfaced the store error; pruning is cleanup.
  }
}

/** Order-independent fingerprint of an incident's resource identity. */
export function resourceFingerprint(resources: Array<{ kind: string; id: string }>): string {
  return resources.map((resource) => `${resource.kind}:${resource.id}`).sort().join('|')
}

/**
 * The ONE re-fire comparison. Returns the incident's ack state, or null
 * when the record no longer applies (caller prunes):
 * - expired snooze → null
 * - ack: tier ESCALATION past tierAtAck or resource-set change → null;
 *   evidence/count drift within the tier stays acked
 * - action_required snooze: ANY evidence change → null
 */
export function resolveAckState(input: {
  record: HealthAckRecord
  effectiveDisposition: HealthAckTier
  resourceFingerprint: string
  evidenceSha: string
  nowMs: number
}): 'acked' | 'snoozed' | null {
  const { record } = input
  // Tier escalation re-fires EVERY mode (review finding: a watch snooze
  // that escalated to action_required stayed silent for the window —
  // violating the never-quietly-silenceable boundary).
  if (TIER_ORDER[input.effectiveDisposition] > TIER_ORDER[record.tierAtAck]) return null
  if (record.mode === 'snooze') {
    if (record.until === undefined || Date.parse(record.until) <= input.nowMs) return null
    if (record.tierAtAck === 'action_required' && record.evidenceSha !== input.evidenceSha) return null
    return 'snoozed'
  }
  if (record.resourceFingerprint !== input.resourceFingerprint) return null
  return 'acked'
}
