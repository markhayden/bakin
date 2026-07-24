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
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
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

export const SNOOZE_MAX_MS = 7 * 24 * 60 * 60 * 1000

const TIER_ORDER: Record<HealthAckTier, number> = {
  advisory: 0,
  watch: 1,
  action_required: 2,
}

function acksPath(): string {
  return join(getBakinPaths().home, 'health', 'acks.json')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}

function isRecord(value: unknown): value is HealthAckRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<HealthAckRecord>
  return typeof record.incidentId === 'string'
    && (record.mode === 'ack' || record.mode === 'snooze')
    && typeof record.at === 'string'
    && (record.until === undefined || typeof record.until === 'string')
    && (record.tierAtAck === 'advisory' || record.tierAtAck === 'watch' || record.tierAtAck === 'action_required')
    && typeof record.resourceFingerprint === 'string'
    && (record.evidenceSha === undefined || typeof record.evidenceSha === 'string')
}

/** Read all records. Missing file = empty; corrupt file = typed error the
 *  projection surfaces as an evidence gap — never a crash, never a silent
 *  reset that would lose the user's acks. */
export function readAckRecords(): Record<string, HealthAckRecord> {
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
  const records: Record<string, HealthAckRecord> = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (isRecord(value)) records[id] = value
  }
  return records
}

function writeAll(records: Record<string, HealthAckRecord>): void {
  const path = acksPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(records, null, 2))
}

/** Validates the tier rules at the storage boundary (defense in depth —
 *  the REST route re-validates with honest HTTP errors). */
export function writeAckRecord(record: HealthAckRecord): void {
  if (record.mode === 'ack' && record.tierAtAck === 'action_required') {
    throw new HealthAckStoreError('action_required incidents cannot be permanently acknowledged — snooze only.')
  }
  if (record.mode === 'snooze') {
    if (!record.until) {
      throw new HealthAckStoreError('Snooze records require an expiry.')
    }
    const window = Date.parse(record.until) - Date.parse(record.at)
    if (!Number.isFinite(window) || window <= 0 || window > SNOOZE_MAX_MS) {
      throw new HealthAckStoreError('Snooze windows are capped at 7 days.')
    }
  }
  const records = readAckRecords()
  records[record.incidentId] = record
  writeAll(records)
}

export function removeAckRecord(incidentId: string): boolean {
  const records = readAckRecords()
  if (!(incidentId in records)) return false
  delete records[incidentId]
  writeAll(records)
  return true
}

/** Lazy prune for records invalidated at projection time (expired snoozes,
 *  escalated acks). Best-effort: pruning never throws into the projection. */
export function pruneAckRecords(incidentIds: string[]): void {
  if (incidentIds.length === 0) return
  try {
    const records = readAckRecords()
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
  if (record.mode === 'snooze') {
    if (record.until !== undefined && Date.parse(record.until) <= input.nowMs) return null
    if (record.tierAtAck === 'action_required'
      && record.evidenceSha !== undefined
      && record.evidenceSha !== input.evidenceSha) return null
    return 'snoozed'
  }
  if (TIER_ORDER[input.effectiveDisposition] > TIER_ORDER[record.tierAtAck]) return null
  if (record.resourceFingerprint !== input.resourceFingerprint) return null
  return 'acked'
}
