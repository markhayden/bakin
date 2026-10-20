/**
 * The updates engine (#1007, D7.1–D7.3): owns the inventory, the records,
 * their persistence and the two clocks. Sources enumerate and observe; the
 * timer (D7.5) decides WHEN; HTTP/CLI only read and ask.
 *
 * Invariants:
 * - Every read awaits boot reconciliation (`ready`): a persisted record whose
 *   fingerprint no longer matches the inventory is served as `unknown` with
 *   `attempt.error = 'inventory changed'` and is due now; a subject that is
 *   gone is dropped; a new subject starts `unknown` and due now.
 * - A failed attempt never overwrites a good observation (`observedAt` is the
 *   last SUCCESS, `attempt` the last attempt); a late observation carrying a
 *   stale fingerprint is dropped.
 * - A skip targets the full available identity and is cleared when it changes.
 * - Writes are serialized; the file is the only durable state.
 */
import { isUpdateSkipped, updateIdentityKey, type UpdateRecord, type UpdatesSnapshot } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'
import { collectInventory, updateRecordId, type InventoryCollection } from './inventory'
import { emptyUpdatesFile, readUpdatesFile, writeUpdatesFile, type UpdatesFile } from './store'
import { UpdateCheckError, type ConditionalStore, type UpdateObservation, type UpdateScheduleEntry, type UpdateSource, type UpdateSubjectInventoryEntry } from './types'

const log = createLogger('updates')

export const INVENTORY_CHANGED = 'inventory changed'
/** Backoff after a failed attempt: 15 min doubling per consecutive failure, capped at 24 h (D7.5). */
export const BACKOFF_BASE_MS = 15 * 60_000
export const BACKOFF_MAX_MS = 24 * 3_600_000

/** A required update is what the installation needs; it cannot be hidden. */
export class UpdateRequiredError extends Error {
  constructor(readonly id: string) {
    super(`"${id}" is a required update — it cannot be skipped`)
    this.name = 'UpdateRequiredError'
  }
}

export class UpdateSubjectNotFoundError extends Error {
  readonly code = 'update_subject_not_found'
  constructor(readonly id: string) {
    super(`no update subject "${id}" in the current inventory`)
  }
}

export interface UpdatesChangedEvent {
  type: 'updates.changed'
  ids: string[]
}

export interface UpdatesEngineOptions {
  storePath: string
  sources: ReadonlyArray<UpdateSource>
  /** Regular re-check interval after a successful observation. */
  /** The check interval — read at scheduling time, so a settings edit takes effect without a restart. */
  intervalMs: number | (() => number)
  now?: () => number
  publish?: (event: UpdatesChangedEvent) => void
}

export interface ObserveOpts {
  signal?: AbortSignal
  /** The attempt's identity: `recordFailure` with the same token retires THIS attempt only (a newer one is left alone). */
  token?: object
}

export interface UpdatesEngine {
  /** Resolves after boot reconciliation; every read awaits it. */
  readonly ready: Promise<void>
  snapshot(): Promise<UpdatesSnapshot>
  /** The current inventory (re-enumerated by `refreshInventory`). */
  inventory(): Promise<UpdateSubjectInventoryEntry[]>
  /** Re-enumerate the sources and reconcile records against the new fingerprints. */
  refreshInventory(): Promise<void>
  /** Ids whose next check is due at `now` (or never checked). */
  dueSubjects(): Promise<string[]>
  scheduleFor(id: string): Promise<UpdateScheduleEntry | undefined>
  /** Observe one subject through its source and apply the result (success or failure). */
  observe(id: string, opts?: ObserveOpts): Promise<UpdateRecord>
  /** Record a failed attempt without a source result (the timer's deadline); the last good observation survives. */
  recordFailure(id: string, error: string, opts?: { token?: object }): Promise<UpdateRecord>
  /** Hide the current available identity until it changes. */
  skip(id: string): Promise<UpdateRecord>
  /** Mark that a check pass is running (for the snapshot's `running`). */
  setRunning(running: boolean): void
}

export function createUpdatesEngine(options: UpdatesEngineOptions): UpdatesEngine {
  const now = options.now ?? (() => Date.now())
  const iso = (ms: number): string => new Date(ms).toISOString()
  const sourcesByKind = new Map(options.sources.map((source) => [source.kind, source] as const))

  let file: UpdatesFile = emptyUpdatesFile()
  let inventoryEntries = new Map<string, UpdateSubjectInventoryEntry>()
  let running = false
  let writing: Promise<void> = Promise.resolve()
  /** Per subject: the attempt in flight. A result from an older attempt (one the timer already gave up on) is dropped. */
  const attempts = new Map<string, object>()
  const interval = (): number => (typeof options.intervalMs === 'function' ? options.intervalMs() : options.intervalMs)

  const conditional: ConditionalStore = {
    get: (key) => file.conditional[key],
    set: (key, entry) => { file.conditional[key] = { ...entry, updatedAt: iso(now()) } },
  }

  function persist(): Promise<void> {
    const snapshot: UpdatesFile = structuredClone(file)
    writing = writing.then(() => { writeUpdatesFile(options.storePath, snapshot) }).catch((err) => {
      log.error('failed to write the updates file', err, { path: options.storePath })
    })
    return writing
  }

  function publish(ids: string[]): void {
    if (ids.length === 0) return
    try {
      options.publish?.({ type: 'updates.changed', ids })
    } catch (err) {
      log.warn('updates.changed listener threw', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  function unknownRecord(entry: UpdateSubjectInventoryEntry, attempt?: UpdateRecord['attempt']): UpdateRecord {
    return {
      id: updateRecordId(entry.subject),
      group: entry.group,
      subject: entry.subject,
      outcome: 'unknown',
      source: entry.source,
      fingerprint: entry.fingerprint,
      ...(attempt ? { attempt } : {}),
    }
  }

  /** Align records + schedule with the inventory. Returns the ids that changed. */
  function reconcile({ entries, failed }: InventoryCollection): string[] {
    const changed: string[] = []
    const previous = inventoryEntries
    inventoryEntries = new Map(entries.map((entry) => [updateRecordId(entry.subject), entry]))
    for (const id of Object.keys(file.records)) {
      if (inventoryEntries.has(id)) continue
      const record = file.records[id]!
      const enumeration = failed.get(record.subject.kind)
      // Known from the previous inventory, or — at boot — from the persisted record itself.
      const known = previous.get(id) ?? (enumeration ? { subject: record.subject, group: record.group, fingerprint: record.fingerprint, source: record.source } : undefined)
      if (enumeration && known) {
        // The source could not enumerate (a hung probe, a dead remote): the
        // subject is unknown for now, not gone — keep it, record the attempt.
        inventoryEntries.set(id, known)
        applyFailure(id, known, iso(now()), `inventory check failed: ${enumeration.message}`)
        changed.push(id)
        continue
      }
      delete file.records[id]
      delete file.schedule[id]
      changed.push(id)
    }
    for (const [id, entry] of inventoryEntries) {
      const existing = file.records[id]
      if (!existing) {
        file.records[id] = unknownRecord(entry)
        file.schedule[id] = { failures: 0 }
        changed.push(id)
      } else if (existing.fingerprint !== entry.fingerprint) {
        // Invalidated: never successfully checked under this identity, due now.
        file.records[id] = unknownRecord(entry, { at: iso(now()), error: INVENTORY_CHANGED })
        file.schedule[id] = { failures: 0, nextDueAt: iso(now()) }
        changed.push(id)
      } else {
        // Subject/group/source labels may have moved without affecting eligibility.
        const next = { ...existing, subject: entry.subject, group: entry.group }
        // A required update is never skippable; a skip persisted before the group moved lapses.
        if (next.group === 'required' && next.skipped) { delete next.skipped; changed.push(id) }
        file.records[id] = next
      }
    }
    return changed
  }

  async function enumerate(): Promise<InventoryCollection> {
    return collectInventory(options.sources, {
      onSourceError: (kind, error) => log.warn('update source failed to enumerate — skipped this pass', { kind, error: error.message }),
    })
  }

  const ready: Promise<void> = (async () => {
    file = readUpdatesFile(options.storePath) ?? emptyUpdatesFile()
    const changed = reconcile(await enumerate())
    await persist()
    if (changed.length > 0) log.info('updates reconciled at boot', { changed: changed.length, subjects: inventoryEntries.size })
  })()

  /** The failure branch both `observe` and `recordFailure` share: attempt + backoff, observation untouched. */
  function applyFailure(id: string, live: UpdateSubjectInventoryEntry, at: string, error: string, retryAfterMs?: number): void {
    const previous = file.records[id] ?? unknownRecord(live)
    const schedule = file.schedule[id] ?? { failures: 0 }
    const failures = schedule.failures + 1
    // The server's own retry hint wins over a shorter backoff; the cap still holds.
    const backoff = Math.min(Math.max(BACKOFF_BASE_MS * 2 ** (failures - 1), retryAfterMs ?? 0), BACKOFF_MAX_MS)
    file.records[id] = { ...previous, attempt: { at, error } }
    file.schedule[id] = { ...schedule, lastCheckedAt: at, nextDueAt: iso(now() + backoff), failures }
  }

  function requireEntry(id: string): UpdateSubjectInventoryEntry {
    const entry = inventoryEntries.get(id)
    if (!entry) throw new UpdateSubjectNotFoundError(id)
    return entry
  }

  /**
   * When a subject is next due. A successful check is due one CURRENT
   * interval after it ran — shortening the interval reschedules every
   * subject, lengthening it defers them; a failed one keeps its recorded
   * backoff; an invalidated one (no `lastCheckedAt`) is due at its recorded
   * time, i.e. now.
   */
  function dueAt(schedule: UpdateScheduleEntry | undefined): number {
    if (!schedule?.nextDueAt) return Number.NEGATIVE_INFINITY
    if (schedule.failures === 0 && schedule.lastCheckedAt) return Date.parse(schedule.lastCheckedAt) + interval()
    return Date.parse(schedule.nextDueAt)
  }

  return {
    ready,

    async snapshot() {
      await ready
      return { records: Object.values(file.records).map((record) => structuredClone(record)), generatedAt: iso(now()), running }
    },

    async inventory() {
      await ready
      return [...inventoryEntries.values()]
    },

    async refreshInventory() {
      await ready
      const changed = reconcile(await enumerate())
      if (changed.length > 0) {
        await persist()
        publish(changed)
      }
    },

    async dueSubjects() {
      await ready
      const at = now()
      return [...inventoryEntries.keys()].filter((id) => dueAt(file.schedule[id]) <= at)
    },

    async scheduleFor(id) {
      await ready
      return file.schedule[id] ? { ...file.schedule[id] } : undefined
    },

    async observe(id, opts = {}) {
      await ready
      const entry = requireEntry(id)
      const source = sourcesByKind.get(entry.subject.kind)
      if (!source) throw new UpdateSubjectNotFoundError(id)
      const signal = opts.signal ?? new AbortController().signal
      const attempt = opts.token ?? {}
      attempts.set(id, attempt)
      let observation: UpdateObservation | null = null
      let error: string | null = null
      let retryAfterMs: number | undefined
      try {
        observation = await source.observe(entry, { signal, conditional })
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        if (err instanceof UpdateCheckError) retryAfterMs = err.retryAfterMs
      }
      const at = iso(now())
      // The timer gave up on this attempt (recorded its deadline) or a newer
      // one started: whatever this one found is stale and is dropped.
      if (attempts.get(id) !== attempt) return structuredClone(file.records[id] ?? unknownRecord(entry))
      // The inventory may have moved while we observed: a stale result is dropped.
      const live = inventoryEntries.get(id)
      if (!live) throw new UpdateSubjectNotFoundError(id)
      if (live.fingerprint !== entry.fingerprint) {
        file.records[id] = unknownRecord(live, { at, error: INVENTORY_CHANGED })
        file.schedule[id] = { failures: 0, nextDueAt: at }
        await persist()
        publish([id])
        return structuredClone(file.records[id]!)
      }
      if (!observation) {
        applyFailure(id, live, at, error ?? 'unknown error', retryAfterMs)
        await persist()
        publish([id])
        return structuredClone(file.records[id]!)
      }
      const previous = file.records[id] ?? unknownRecord(live)
      {
        const next: UpdateRecord = {
          id,
          group: live.group,
          subject: live.subject,
          installed: observation.installed,
          available: observation.available,
          reason: observation.reason,
          outcome: observation.outcome,
          source: observation.source ?? live.source,
          observedAt: at,
          attempt: { at },
          fingerprint: live.fingerprint,
          action: observation.action,
          blockedReason: observation.blockedReason,
          notesUrl: observation.notesUrl,
        }
        // A skip survives only while the available identity it targeted is still the one offered.
        if (previous.skipped && updateIdentityKey(previous.skipped) === updateIdentityKey(next.available)) next.skipped = previous.skipped
        file.records[id] = stripUndefined(next)
        file.schedule[id] = { lastCheckedAt: at, nextDueAt: iso(now() + interval()), failures: 0 }
      }
      await persist()
      publish([id])
      return structuredClone(file.records[id]!)
    },

    async recordFailure(id, error, opts = {}) {
      await ready
      const live = requireEntry(id)
      // Only the attempt that hit the deadline is retired: a newer attempt
      // (a check that started meanwhile) owns the subject now.
      if (opts.token && attempts.get(id) !== opts.token) return structuredClone(file.records[id] ?? unknownRecord(live))
      attempts.set(id, {})
      applyFailure(id, live, iso(now()), error)
      await persist()
      publish([id])
      return structuredClone(file.records[id]!)
    },

    async skip(id) {
      await ready
      requireEntry(id)
      const record = file.records[id]
      if (!record || !record.available || updateIdentityKey(record.available) === null) {
        throw new Error(`"${id}" has nothing to skip — no available identity`)
      }
      if (record.group === 'required') throw new UpdateRequiredError(id)
      const { version, sha, digest } = record.available
      record.skipped = stripUndefined({ version, sha, digest })
      await persist()
      publish([id])
      return structuredClone(record)
    },

    setRunning(value) {
      running = value
    },
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

export { isUpdateSkipped }
