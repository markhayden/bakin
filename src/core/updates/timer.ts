/**
 * The update scheduler (#1007, D7.5): an independent core timer with
 * per-subject due times, a global bound of 2 concurrent SUBJECTS, a
 * per-subject deadline that releases the slot (and records the failure)
 * even when a source ignores its signal, backoff owned by the engine, and
 * "Check now" coalescing into a running pass.
 *
 * The timer decides WHEN; the engine owns WHAT a result means. Settings are
 * re-read on every tick: disabling mid-pass lets the running subjects finish
 * and schedules nothing more; an explicit check still runs when disabled.
 */
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'
import { UpdateSubjectNotFoundError, type UpdatesEngine } from './engine'

const log = createLogger('updates-timer')

export interface UpdatesTimerSettings {
  enabled: boolean
}

export interface UpdatesTimerOptions {
  engine: UpdatesEngine
  settings: () => UpdatesTimerSettings
  /** Tick cadence — how often due subjects are looked for. Default 60 s. */
  tickMs?: number
  /** The first tick lands this long after start (overdue subjects are checked shortly after boot). Default = tickMs. */
  firstTickMs?: number
  /** Deadline per subject. Default 20 s. */
  subjectTimeoutMs?: number
  /** Global bound of subjects observed at once. Default 2. */
  concurrency?: number
  /** After the deadline, how long a cooperative observer gets to settle (and record its own failure) before the slot is released and the deadline recorded. Default 5 s. */
  cancelGraceMs?: number
  now?: () => number
}

export interface CheckRequest {
  /** Only these record ids (every id must be in the inventory — otherwise the check is refused). */
  ids?: string[]
  /** Only subjects of this kind. */
  kind?: string
}

export interface CheckRun {
  /** Record ids this request observed (or found already observed by the pass it joined). */
  ids: string[]
  /** True when the request attached to a pass that was already running. */
  coalesced: boolean
  /**
   * THIS request's attempt result per subject it rode (a named id always
   * rides one; a broad request only for subjects the pass had not reached):
   * the record the engine wrote for that attempt — a failed attempt's record
   * carries `attempt.error`. Never a later attempt's result (review r1 #2).
   */
  results: Map<string, UpdateRecord>
  /** Attempts whose engine call itself rejected (the subject vanished, the store failed) — by subject id. */
  errors: Map<string, Error>
}

/** A check the timer accepted: the ids it will observe, and the pass they ride. */
export interface CheckAdmission extends CheckRun {
  /** Resolves when every admitted subject has been observed; rejects when one asked for by name vanished before its turn. */
  done: Promise<CheckRun>
}

export interface UpdatesTimer {
  /**
   * Admit a check: refresh the inventory ONCE (serialized with every other
   * pass startup — never a probe per caller, review r4 #5), validate the
   * requested ids against it (an unknown id rejects with not-found before
   * anything runs), then join the running pass or start one. Answers as soon
   * as the work is queued; `done` follows it.
   */
  admit(request?: CheckRequest): Promise<CheckAdmission>
  /** `admit` and wait for it: observe the requested subjects now (all subjects by default — not only the due ones). */
  check(request?: CheckRequest): Promise<CheckRun>
  /** True while a pass is running. */
  running(): boolean
  stop(): void
}

export const UPDATES_TICK_MS = 60_000
export const UPDATES_SUBJECT_TIMEOUT_MS = 20_000
export const UPDATES_CONCURRENCY = 2
export const UPDATES_CANCEL_GRACE_MS = 5_000
export const SUBJECT_TIMED_OUT = (ms: number): string => `check timed out after ${Math.round(ms / 1000)}s`

/** `check()` after `stop()`: the timer is gone, nothing will be observed — never a silent success. */
export class UpdatesStoppedError extends Error {
  constructor() {
    super('the update checker is stopped')
    this.name = 'UpdatesStoppedError'
  }
}

export function startUpdatesTimer(options: UpdatesTimerOptions): UpdatesTimer {
  const { engine } = options
  const tickMs = options.tickMs ?? UPDATES_TICK_MS
  const firstTickMs = options.firstTickMs ?? tickMs
  const subjectTimeoutMs = options.subjectTimeoutMs ?? UPDATES_SUBJECT_TIMEOUT_MS
  const concurrency = Math.max(1, options.concurrency ?? UPDATES_CONCURRENCY)
  const cancelGraceMs = options.cancelGraceMs ?? UPDATES_CANCEL_GRACE_MS

  /** The one running pass, if any. */
  let pass: Pass | null = null
  /** Pass startup (inventory refresh + creation) is serialized, so a tick and a check never start two. */
  let startup: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = startup.then(fn, fn)
    startup = run.then(() => undefined, () => undefined)
    return run
  }
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  /** One admitted request's view of the pass: the subjects that were gone when THEIR attempt's turn came, and each attempt's own result. */
  interface Waiter {
    missing: Set<string>
    results: Map<string, UpdateRecord>
    errors: Map<string, Error>
  }

  /** One queued observation and the requests riding it — a later attempt for the same id is a different item (review r5 #5). */
  interface QueuedAttempt {
    id: string
    waiters: Set<Waiter>
  }

  interface Pass {
    /** Attempts the pass must still run, in order; a manual request can append or ride a queued one. */
    queue: QueuedAttempt[]
    /** Subjects being observed right now: a repeat attempt waits for its predecessor to settle (review r7 #3). */
    active: Map<string, Promise<void>>
    reached: Set<string>
    /** Ids a caller asked for by name: observed even when scheduled work is disabled mid-pass. */
    explicit: Set<string>
    done: Promise<void>
    /** True for a scheduled pass: honours `enabled` between subjects. */
    scheduled: boolean
  }

  /**
   * One attempt: observe under a deadline. On the deadline the signal fires
   * and a cooperative observer settles through the engine (recording the
   * deadline as ITS failure — once). An observer that ignores its signal
   * gets a bounded grace; after it the slot is released and the engine
   * records the deadline, retiring the attempt so a late result is dropped.
   */
  async function observeWithDeadline(attempt: QueuedAttempt): Promise<void> {
    const { id } = attempt
    const controller = new AbortController()
    const token = {}
    let settled = false
    // Engine refusals never escape an attempt: the pass goes on and keeps
    // its ownership until every worker settles. A subject that vanished
    // after it was admitted is marked on THIS attempt's waiters, so the
    // requests that named it fail (review r4 #6, r5 #2/#5) — a broad request
    // simply no longer has it; a later attempt for the same id is its own.
    const refused = (err: unknown): void => {
      if (err instanceof UpdateSubjectNotFoundError) for (const waiter of attempt.waiters) waiter.missing.add(id)
      log.warn('update check failed to start', { id, error: err instanceof Error ? err.message : String(err) })
    }
    // The attempt's FIRST settlement is its result for every request riding
    // it: the engine's record (success or recorded failure), the deadline's
    // record, or the engine's own rejection. A late result from an attempt
    // the deadline already closed never replaces it.
    const settle = (outcome: { record: UpdateRecord } | { error: unknown }): void => {
      for (const waiter of attempt.waiters) {
        if (waiter.results.has(id) || waiter.errors.has(id)) continue
        if ('record' in outcome) waiter.results.set(id, outcome.record)
        else waiter.errors.set(id, outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error)))
      }
    }
    const observing = engine.observe(id, { signal: controller.signal, token })
      .then((record) => { settle({ record }) }, (err: unknown) => { refused(err); settle({ error: err }) })
      .finally(() => { settled = true })
    const timedOut = await Promise.race([
      observing.then(() => false),
      new Promise<boolean>((resolve) => { const t = setTimeout(() => resolve(true), subjectTimeoutMs); t.unref?.() }),
    ])
    if (!timedOut) return
    controller.abort(new Error(SUBJECT_TIMED_OUT(subjectTimeoutMs)))
    await Promise.race([observing, new Promise<void>((resolve) => { const t = setTimeout(resolve, cancelGraceMs); t.unref?.() })])
    if (settled) return
    try {
      settle({ record: await engine.recordFailure(id, SUBJECT_TIMED_OUT(subjectTimeoutMs), { token }) })
    } catch (err) {
      // Removed during the grace: the deadline has nowhere to land — an attempt-specific result, not the pass's.
      refused(err)
      settle({ error: err })
    }
  }

  function runPass(initial: QueuedAttempt[], scheduled: boolean, explicitIds: readonly string[] = []): Pass {
    const queue = [...initial]
    const active = new Map<string, Promise<void>>()
    const reached = new Set<string>()
    const explicit = new Set(explicitIds)
    engine.setRunning(true)
    const done = (async () => {
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          if (stopped) return
          const attempt = queue.shift()
          if (attempt === undefined) return
          // Disabled mid-pass: scheduled work stops here, but a subject someone
          // asked for by name is still observed — a check never answers
          // "done" without having looked.
          if (scheduled && !options.settings().enabled && !explicit.has(attempt.id)) continue
          // Two attempts for one subject never overlap: the engine keeps one
          // attempt token per subject, and a newer one would discard the
          // older result — even a successful one — so the repeat waits.
          while (active.has(attempt.id)) await active.get(attempt.id)
          reached.add(attempt.id)
          const observation = observeWithDeadline(attempt)
          active.set(attempt.id, observation)
          try {
            await observation
          } finally {
            if (active.get(attempt.id) === observation) active.delete(attempt.id)
          }
        }
      })
      // The pass owns `running` until EVERY worker has settled — never released by one worker's failure.
      await Promise.allSettled(workers)
    })().finally(() => {
      if (pass === current) pass = null
      engine.setRunning(false)
    })
    const current: Pass = { queue, active, reached, explicit, done, scheduled }
    pass = current
    return current
  }

  async function tick(): Promise<void> {
    const started = await serialized(async () => {
      if (stopped || pass) return null
      if (!options.settings().enabled) return null
      // Installed/removed subjects and changed settings join or leave here.
      await engine.refreshInventory()
      if (stopped || pass) return null
      const due = await engine.dueSubjects()
      if (due.length === 0) return null
      log.debug('update check pass', { due: due.length })
      return runPass(due.map((id) => ({ id, waiters: new Set<Waiter>() })), true)
    })
    if (started) await started.done
  }

  function schedule(delay: number): void {
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      tick().catch((error) => log.error('Update check pass failed', error)).finally(() => schedule(tickMs))
    }, delay)
    timer.unref?.()
  }
  schedule(firstTickMs)

  async function admit(request: CheckRequest = {}): Promise<CheckAdmission> {
    const waiter: Waiter = { missing: new Set(), results: new Map(), errors: new Map() }
    const { ids, run, coalesced } = await serialized(async () => {
      if (stopped) throw new UpdatesStoppedError()
      await engine.refreshInventory()
      const inventory = await engine.inventory()
      // A stop that landed during the refresh: nothing will be observed — never an accepted check (review r5 #6).
      if (stopped) throw new UpdatesStoppedError()
      const known = new Set(inventory.map((entry) => `${entry.subject.kind}:${entry.subject.id}`))
      let ids = [...known]
      if (request.kind) ids = ids.filter((id) => id.startsWith(`${request.kind}:`))
      if (request.ids) {
        for (const id of request.ids) if (!known.has(id)) throw new UpdateSubjectNotFoundError(id)
        // One attempt per subject: a repeated id must not occupy two workers (the second would supersede the first).
        ids = [...new Set(request.ids)]
      }
      if (pass) {
        // Join the running pass. A broad request takes whatever the pass
        // already reached; an EXPLICIT id is observed again regardless (the
        // caller knows the subject changed — a reached result is stale). A
        // request rides the queued attempt for its id when there is one.
        const running = pass
        for (const id of ids) {
          running.explicit.add(id)
          const queued = running.queue.find((attempt) => attempt.id === id)
          if (queued) { queued.waiters.add(waiter); continue }
          if (request.ids || !running.reached.has(id)) running.queue.push({ id, waiters: new Set([waiter]) })
        }
        return { ids, run: running, coalesced: true }
      }
      return { ids, run: runPass(ids.map((id) => ({ id, waiters: new Set([waiter]) })), false, ids), coalesced: false }
    })
    const done = run.done.then(() => {
      if (stopped) throw new UpdatesStoppedError()
      // Named subjects must have been LOOKED AT: one removed while THIS request's attempt waited its turn fails it.
      const gone = request.ids?.find((id) => waiter.missing.has(id))
      if (gone !== undefined) throw new UpdateSubjectNotFoundError(gone)
      return { ids, coalesced, results: waiter.results, errors: waiter.errors }
    })
    return { ids, coalesced, results: waiter.results, errors: waiter.errors, done }
  }

  return {
    admit,
    check: async (request = {}) => (await admit(request)).done,
    running: () => pass !== null,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
