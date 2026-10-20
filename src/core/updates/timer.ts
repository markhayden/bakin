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
import { createLogger } from '../logger'
import type { UpdatesEngine } from './engine'

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
}

export interface UpdatesTimer {
  /** Observe the requested subjects now (all subjects by default — not only the due ones). Joins a running pass. */
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

export function startUpdatesTimer(options: UpdatesTimerOptions): UpdatesTimer {
  const { engine } = options
  const tickMs = options.tickMs ?? UPDATES_TICK_MS
  const firstTickMs = options.firstTickMs ?? tickMs
  const subjectTimeoutMs = options.subjectTimeoutMs ?? UPDATES_SUBJECT_TIMEOUT_MS
  const concurrency = Math.max(1, options.concurrency ?? UPDATES_CONCURRENCY)
  const cancelGraceMs = options.cancelGraceMs ?? UPDATES_CANCEL_GRACE_MS

  /** The one running pass, if any. */
  let pass: Pass | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  interface Pass {
    queue: string[]
    reached: Set<string>
    /** Ids the pass must still observe, in order; a manual request can append. */
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
  async function observeWithDeadline(id: string): Promise<void> {
    const controller = new AbortController()
    let settled = false
    const observing = engine.observe(id, { signal: controller.signal }).then(() => undefined, (err: unknown) => {
      // Not-found and other engine refusals: logged, the pass goes on.
      log.warn('update check failed to start', { id, error: err instanceof Error ? err.message : String(err) })
    }).finally(() => { settled = true })
    const timedOut = await Promise.race([
      observing.then(() => false),
      new Promise<boolean>((resolve) => { const t = setTimeout(() => resolve(true), subjectTimeoutMs); t.unref?.() }),
    ])
    if (!timedOut) return
    controller.abort(new Error(SUBJECT_TIMED_OUT(subjectTimeoutMs)))
    await Promise.race([observing, new Promise<void>((resolve) => { const t = setTimeout(resolve, cancelGraceMs); t.unref?.() })])
    if (!settled) await engine.recordFailure(id, SUBJECT_TIMED_OUT(subjectTimeoutMs))
  }

  function runPass(initial: string[], scheduled: boolean): Pass {
    const queue = [...initial]
    const reached = new Set<string>()
    engine.setRunning(true)
    const done = (async () => {
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          if (stopped) return
          if (scheduled && !options.settings().enabled) return
          const id = queue.shift()
          if (id === undefined) return
          reached.add(id)
          await observeWithDeadline(id)
        }
      })
      await Promise.all(workers)
    })().finally(() => {
      if (pass === current) pass = null
      engine.setRunning(false)
    })
    const current: Pass = { queue, reached, done, scheduled }
    pass = current
    return current
  }

  async function tick(): Promise<void> {
    if (stopped || pass) return
    if (!options.settings().enabled) return
    // Installed/removed subjects and changed settings join or leave here.
    await engine.refreshInventory()
    const due = await engine.dueSubjects()
    if (due.length === 0) return
    log.debug('update check pass', { due: due.length })
    await runPass(due, true).done
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

  return {
    async check(request = {}) {
      await engine.refreshInventory()
      const inventory = await engine.inventory()
      const known = new Set(inventory.map((entry) => `${entry.subject.kind}:${entry.subject.id}`))
      let ids = [...known]
      if (request.kind) ids = ids.filter((id) => id.startsWith(`${request.kind}:`))
      if (request.ids) {
        const { UpdateSubjectNotFoundError } = await import('./engine')
        for (const id of request.ids) if (!known.has(id)) throw new UpdateSubjectNotFoundError(id)
        ids = request.ids
      }
      if (pass) {
        // Join the running pass: queue whatever it has not reached yet.
        const running = pass
        for (const id of ids) if (!running.reached.has(id) && !running.queue.includes(id)) running.queue.push(id)
        await running.done
        return { ids, coalesced: true }
      }
      await runPass(ids, false).done
      return { ids, coalesced: false }
    },
    running: () => pass !== null,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
