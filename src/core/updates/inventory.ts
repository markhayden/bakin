/** Subject inventory across sources: kind-prefixed ids and stable fingerprints (#1007, D7.3). */
import { createHash } from 'node:crypto'
import type { UpdateSubject } from '@makinbakin/sdk/types'
import type { UpdateSource, UpdateSubjectInventoryEntry } from './types'

/** `<kind>:<subjectId>` — the record id. Kinds partition the id space. */
export function updateRecordId(subject: Pick<UpdateSubject, 'kind' | 'id'>): string {
  return `${subject.kind}:${subject.id}`
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    )
  }
  return value
}

/** A short, key-order-independent hash of any JSON-able value. */
export function fingerprintOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(parts))).digest('hex').slice(0, 24)
}

export interface CollectInventoryOptions {
  /** A source whose inventory throws (or lies about its kind) is reported here and skipped — never fatal. */
  onSourceError?: (kind: UpdateSource['kind'], error: Error) => void
}

export interface InventoryCollection {
  entries: UpdateSubjectInventoryEntry[]
  /** Sources whose enumeration FAILED this time: their subjects are unknown, not absent. */
  failed: Map<UpdateSource['kind'], Error>
}

/**
 * Every subject every source knows about, in source order. A source whose
 * enumeration throws is reported in `failed` (and through `onSourceError`)
 * — the engine keeps that kind's known subjects and records the failure,
 * never deletes them (#1007 review r2 #2).
 */
export async function collectInventory(sources: ReadonlyArray<UpdateSource>, opts: CollectInventoryOptions = {}): Promise<InventoryCollection> {
  const entries: UpdateSubjectInventoryEntry[] = []
  const failed = new Map<UpdateSource['kind'], Error>()
  for (const source of sources) {
    try {
      const own = await source.inventory()
      const foreign = own.find((entry) => entry.subject.kind !== source.kind)
      if (foreign) throw new Error(`source "${source.kind}" enumerated a "${foreign.subject.kind}" subject (${foreign.subject.id}); ids are partitioned by kind`)
      entries.push(...own)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      failed.set(source.kind, error)
      opts.onSourceError?.(source.kind, error)
    }
  }
  return { entries, failed }
}
