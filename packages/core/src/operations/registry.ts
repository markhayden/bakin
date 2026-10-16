/**
 * The operations registry (#895) — lifecycle, attach, cancel, outcomes,
 * quiet/stuck, complete-view events and the audit record.
 *
 * Side effects are injected (`publish`, `audit`, `log`, `bootId`, `now`):
 * the app wires SSE and the audit log (`src/core/operations.ts`), tests pass
 * fakes, and nothing here reaches into the app. In-memory by design (D3):
 * identity is boot-scoped and clients tell finished / expired / restarted /
 * unreachable apart from the `bootId` on every response.
 */
import { randomUUID } from 'node:crypto'

import {
  operationQuietState,
  type OperationAttempt,
  type OperationBytes,
  type OperationCancelResult,
  type OperationContext,
  type OperationItem,
  type OperationLogEntry,
  type OperationLogLevel,
  type OperationOrigin,
  type OperationOutcome,
  type OperationOwner,
  type OperationPlan,
  type OperationStageStatus,
  type OperationStageView,
  type OperationStartResponse,
  type OperationView,
} from '@makinbakin/sdk/types'
import { OperationCancelledError } from './errors'

export type OperationPublishKind = 'milestone' | 'tick'

export interface OperationRegistryDeps {
  bootId: () => string
  now?: () => number
  /** Milestones are replayable (`broadcast`); ticks are live-only (`broadcastEphemeral`). */
  publish: (view: OperationView, kind: OperationPublishKind) => void
  /** One record per finished top-level operation. */
  audit?: (event: string, data: Record<string, unknown>) => void
  /** Mirrors every activity-log line into the server log, keyed by operation id. */
  log?: (level: OperationLogLevel, text: string, meta: { operationId: string; stageId?: string }) => void
  /** Tick throttle window per operation (D9: ≤2/s). */
  tickIntervalMs?: number
  /** How long finished operations stay listed. */
  finishedTtlMs?: number
  /** At most this many finished operations are kept. */
  maxFinished?: number
  /** Cadence of the stuck sweep; 0 disables the timer (tests call `checkQuiet`). */
  quietCheckIntervalMs?: number
}

export interface StartOperationInput<B = unknown> {
  kind: string
  owner: OperationOwner
  origin: OperationOrigin
  title: string
  href?: string
  /** Kind + normalized inputs. A live operation with the same fingerprint is attached to (D7). */
  fingerprint: string
  resources?: string[]
  plan: OperationPlan
  /** Synchronous rejections (today's 4xx). A throw unregisters the operation and reaches the caller. */
  validate?: () => void | Promise<void>
  run: (op: OperationContext) => Promise<OperationOutcome<B>>
}

export interface OperationRegistry {
  start<B>(input: StartOperationInput<B>): Promise<OperationStartResponse>
  cancel(id: string): OperationCancelResult
  get(id: string): OperationView | null
  /** Top level: live plus recently finished, newest first. */
  list(): OperationView[]
  /** Resolves with the terminal view; rejects for an unknown id. */
  await(id: string): Promise<OperationView>
  /** Flags each running operation's active stage as stuck once (also runs on a timer). */
  checkQuiet(): void
  /** SIGTERM: note it in every live log. No audit — the next boot reports "restarted". */
  shutdown(): void
  /** Stops timers (tests). */
  dispose(): void
}

/** Lines carried by published views; reads return the full tail. */
const EVENT_LOG_TAIL = 20
const LOG_LIMIT = 100
const OUTPUT_PREVIEW_MAX = 500

interface Entry {
  view: OperationView
  validated: Promise<void>
  registered: boolean
  controller: AbortController
  cancelRequested: boolean
  held: Set<string>
  stuckFlagged: Set<string>
  waiters: Array<(view: OperationView) => void>
  lastPublishAt: number
  tickTimer?: ReturnType<typeof setTimeout>
}

const isTerminal = (status: OperationView['status']) => status === 'succeeded' || status === 'failed' || status === 'cancelled'

export function createOperationRegistry(deps: OperationRegistryDeps): OperationRegistry {
  const now = deps.now ?? Date.now
  const tickIntervalMs = deps.tickIntervalMs ?? 500
  const finishedTtlMs = deps.finishedTtlMs ?? 60 * 60_000
  const maxFinished = deps.maxFinished ?? 50
  const quietCheckIntervalMs = deps.quietCheckIntervalMs ?? 1_000

  const entries = new Map<string, Entry>()
  const liveByFingerprint = new Map<string, Entry>()
  let quietTimer: ReturnType<typeof setInterval> | undefined

  const iso = () => new Date(now()).toISOString()

  function snapshot(entry: Entry, logTail?: number): OperationView {
    const v = entry.view
    return structuredClone({ ...v, log: logTail === undefined ? v.log : v.log.slice(-logTail) })
  }

  function publishNow(entry: Entry, kind: OperationPublishKind): void {
    if (entry.tickTimer) {
      clearTimeout(entry.tickTimer)
      entry.tickTimer = undefined
    }
    entry.lastPublishAt = now()
    deps.publish(snapshot(entry, EVENT_LOG_TAIL), kind)
  }

  /** Every mutation bumps rev; milestones publish now, ticks coalesce to the throttle window. */
  function changed(entry: Entry, kind: OperationPublishKind): void {
    entry.view.rev++
    if (!entry.registered) return
    if (kind === 'milestone') return publishNow(entry, 'milestone')
    if (entry.tickTimer) return
    const wait = entry.lastPublishAt + tickIntervalMs - now()
    if (wait <= 0) return publishNow(entry, 'tick')
    entry.tickTimer = setTimeout(() => {
      entry.tickTimer = undefined
      if (!isTerminal(entry.view.status)) publishNow(entry, 'tick')
    }, Math.min(wait, tickIntervalMs))
  }

  function progressed(entry: Entry): void {
    const at = iso()
    entry.view.lastProgressAt = at
    entry.view.lastLivenessAt = at
  }

  function appendLog(entry: Entry, level: OperationLogLevel, text: string, stageId?: string): void {
    const line: OperationLogEntry = { at: iso(), level, text, ...(stageId ? { stageId } : {}) }
    entry.view.log.push(line)
    if (entry.view.log.length > LOG_LIMIT) entry.view.log.splice(0, entry.view.log.length - LOG_LIMIT)
    deps.log?.(level, text, { operationId: entry.view.id, ...(stageId ? { stageId } : {}) })
  }

  function stageOf(entry: Entry, stageId: string): OperationStageView {
    const stage = entry.view.stages.find((s) => s.id === stageId)
    if (!stage) throw new Error(`Operation ${entry.view.id} (${entry.view.kind}) has no stage '${stageId}'`)
    return stage
  }

  function cancelPending(entry: Entry): boolean {
    return entry.cancelRequested && entry.view.cancellable
  }

  function createContext(entry: Entry): OperationContext {
    const live = () => !isTerminal(entry.view.status)
    return {
      id: entry.view.id,
      signal: entry.controller.signal,

      stage(stageId, message) {
        if (!live()) return
        if (cancelPending(entry)) throw new OperationCancelledError(entry.view.id)
        const target = stageOf(entry, stageId)
        const at = iso()
        for (const s of entry.view.stages) {
          if (s === target) break
          if (s.status === 'active') {
            s.status = 'done'
            s.endedAt = at
          } else if (s.status === 'pending') {
            s.status = 'skipped'
            s.skippedReason = 'not needed'
          }
        }
        target.status = 'active'
        target.startedAt = at
        if (message !== undefined) target.message = message
        if (entry.view.plan.pointOfNoReturn === stageId) entry.view.cancellable = false
        progressed(entry)
        appendLog(entry, 'info', message ? `${target.label}: ${message}` : target.label, stageId)
        changed(entry, 'milestone')
      },

      item(stageId, patch) {
        if (!live()) return
        const stage = stageOf(entry, stageId)
        const items = (stage.items ??= [])
        const existing = items.find((i) => i.id === patch.id)
        const before: OperationStageStatus | undefined = existing?.status
        const next: OperationItem = { ...existing, ...patch, status: patch.status ?? existing?.status ?? 'pending' }
        if (existing) Object.assign(existing, next)
        else items.push(next)
        const statusChanged = next.status !== before
        if (statusChanged && (next.status === 'done' || next.status === 'skipped')) progressed(entry)
        if (statusChanged && next.status === 'failed') appendLog(entry, 'error', `${next.label}${next.message ? `: ${next.message}` : ''}`, stageId)
        changed(entry, statusChanged && next.status !== 'pending' ? 'milestone' : 'tick')
      },

      bytes(stageId, bytes: OperationBytes, itemId) {
        if (!live()) return
        const stage = stageOf(entry, stageId)
        const target = itemId ? stage.items?.find((i) => i.id === itemId) : stage
        if (!target) throw new Error(`Operation ${entry.view.id} stage '${stageId}' has no item '${itemId}'`)
        const previous = target.bytes?.received ?? -1
        target.bytes = { ...bytes }
        if (bytes.received > previous) progressed(entry)
        changed(entry, 'tick')
      },

      attempt(stageId, attempt: OperationAttempt) {
        if (!live()) return
        const stage = stageOf(entry, stageId)
        stage.attempt = { ...attempt }
        entry.view.lastLivenessAt = iso()
        appendLog(entry, 'warn', `Retrying (attempt ${attempt.n} of ${attempt.of}) — ${attempt.reason}${attempt.detail ? `: ${attempt.detail}` : ''}`, stageId)
        changed(entry, 'milestone')
      },

      output(line) {
        if (!live()) return
        const text = line.trimEnd()
        entry.view.lastOutput = text.length > OUTPUT_PREVIEW_MAX ? `${text.slice(0, OUTPUT_PREVIEW_MAX)}…` : text
        entry.view.lastLivenessAt = iso()
        appendLog(entry, 'info', text, entry.view.stages.find((s) => s.status === 'active')?.id)
        changed(entry, 'tick')
      },

      log(text, level = 'info') {
        if (!live()) return
        appendLog(entry, level, text, entry.view.stages.find((s) => s.status === 'active')?.id)
        changed(entry, level === 'info' ? 'tick' : 'milestone')
      },

      skip(stageId, reason) {
        if (!live()) return
        const stage = stageOf(entry, stageId)
        stage.status = 'skipped'
        stage.skippedReason = reason
        progressed(entry)
        changed(entry, 'milestone')
      },

      throwIfCancelled() {
        if (cancelPending(entry)) throw new OperationCancelledError(entry.view.id)
      },

      holds(resource) {
        return entry.held.has(resource)
      },
    }
  }

  function finish(entry: Entry, status: 'succeeded' | 'failed' | 'cancelled', outcome: OperationOutcome | null, code: string, message?: string): void {
    const view = entry.view
    const at = iso()
    for (const s of view.stages) {
      if (s.status === 'active') {
        s.endedAt = at
        if (status === 'succeeded') s.status = 'done'
        else if (status === 'failed') s.status = 'failed'
        else {
          s.status = 'skipped'
          s.skippedReason = 'cancelled'
        }
      } else if (s.status === 'pending' && status === 'succeeded') {
        s.status = 'skipped'
        s.skippedReason = 'not needed'
      }
    }
    view.status = status
    view.endedAt = at
    view.cancellable = false
    view.outcome = {
      code,
      ...(message ? { message } : {}),
      ...(code === 'partially_applied' ? { partiallyApplied: true } : {}),
    }
    if (outcome) view.result = { httpStatus: outcome.httpStatus, body: outcome.body }
    appendLog(entry, status === 'succeeded' ? 'info' : status === 'failed' ? 'error' : 'warn', message ? `${status}: ${message}` : status)
    if (liveByFingerprint.get(view.fingerprint) === entry) liveByFingerprint.delete(view.fingerprint)
    changed(entry, 'milestone')

    if (!view.parentId) {
      deps.audit?.(`operation.${status}`, {
        operationId: view.id,
        kind: view.kind,
        owner: view.owner,
        origin: view.origin,
        title: view.title,
        durationMs: Date.parse(at) - Date.parse(view.startedAt),
        code,
      })
    }
    const terminal = snapshot(entry)
    for (const resolve of entry.waiters.splice(0)) resolve(terminal)
    evict()
    if (![...entries.values()].some((e) => e.registered && !isTerminal(e.view.status))) stopQuietTimer()
  }

  async function runEntry<B>(entry: Entry, run: StartOperationInput<B>['run']): Promise<void> {
    const ctx = createContext(entry)
    try {
      const outcome = await run(ctx)
      finish(entry, outcome.status, outcome, outcome.code, outcome.message)
    } catch (err) {
      if (err instanceof OperationCancelledError && entry.cancelRequested) {
        finish(entry, 'cancelled', null, 'cancelled')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      finish(entry, 'failed', { status: 'failed', code: 'unexpected', httpStatus: 500, body: { error: message } }, 'unexpected', message)
    }
  }

  function evict(): void {
    const cutoff = now() - finishedTtlMs
    const finished = [...entries.values()]
      .filter((e) => !e.view.parentId && isTerminal(e.view.status))
      .sort((a, b) => Date.parse(b.view.endedAt!) - Date.parse(a.view.endedAt!))
    finished.forEach((e, index) => {
      if (index >= maxFinished || Date.parse(e.view.endedAt!) < cutoff) entries.delete(e.view.id)
    })
  }

  function startQuietTimer(): void {
    if (quietTimer || quietCheckIntervalMs <= 0) return
    quietTimer = setInterval(() => registry.checkQuiet(), quietCheckIntervalMs)
    quietTimer.unref?.()
  }

  function stopQuietTimer(): void {
    if (quietTimer) clearInterval(quietTimer)
    quietTimer = undefined
  }

  const registry: OperationRegistry = {
    async start<B>(input: StartOperationInput<B>): Promise<OperationStartResponse> {
      const twin = liveByFingerprint.get(input.fingerprint)
      if (twin) {
        await twin.validated
        return { operationId: twin.view.id, bootId: deps.bootId(), attached: true }
      }

      const at = iso()
      const entry: Entry = {
        view: {
          id: randomUUID(),
          children: [],
          rev: 0,
          bootId: deps.bootId(),
          kind: input.kind,
          owner: input.owner,
          origin: input.origin,
          title: input.title,
          ...(input.href ? { href: input.href } : {}),
          fingerprint: input.fingerprint,
          resources: [...(input.resources ?? [])],
          status: 'running',
          plan: structuredClone(input.plan),
          stages: input.plan.stages.map((s) => ({ ...structuredClone(s), status: 'pending' as const })),
          cancellable: input.plan.pointOfNoReturn !== 'start',
          startedAt: at,
          lastProgressAt: at,
          lastLivenessAt: at,
          log: [],
        },
        validated: Promise.resolve(),
        registered: false,
        controller: new AbortController(),
        cancelRequested: false,
        held: new Set(),
        stuckFlagged: new Set(),
        waiters: [],
        lastPublishAt: 0,
      }
      liveByFingerprint.set(input.fingerprint, entry)
      entry.validated = (async () => { await input.validate?.() })()
      try {
        await entry.validated
      } catch (err) {
        liveByFingerprint.delete(input.fingerprint)
        throw err
      }

      entries.set(entry.view.id, entry)
      entry.registered = true
      appendLog(entry, 'info', `Started: ${input.title}`)
      changed(entry, 'milestone')
      startQuietTimer()
      void runEntry(entry, input.run)
      return { operationId: entry.view.id, bootId: entry.view.bootId }
    },

    cancel(id) {
      const entry = entries.get(id)
      if (!entry) return 'not_found'
      if (isTerminal(entry.view.status)) return 'already_finished'
      if (entry.view.status === 'cancelling') return 'cancelling'
      if (!entry.view.cancellable) return 'not_cancellable'
      entry.cancelRequested = true
      entry.view.status = 'cancelling'
      appendLog(entry, 'warn', 'Cancel requested')
      entry.controller.abort(new OperationCancelledError(id))
      changed(entry, 'milestone')
      return 'cancelling'
    },

    get(id) {
      const entry = entries.get(id)
      return entry ? snapshot(entry) : null
    },

    list() {
      evict()
      return [...entries.values()]
        .filter((e) => !e.view.parentId)
        .sort((a, b) => Date.parse(b.view.startedAt) - Date.parse(a.view.startedAt))
        .map((e) => snapshot(e, EVENT_LOG_TAIL))
    },

    await(id) {
      const entry = entries.get(id)
      if (!entry) return Promise.reject(new Error(`Unknown operation: ${id}`))
      if (isTerminal(entry.view.status)) return Promise.resolve(snapshot(entry))
      return new Promise((resolve) => entry.waiters.push(resolve))
    },

    checkQuiet() {
      const at = now()
      for (const entry of entries.values()) {
        if (!entry.registered || isTerminal(entry.view.status)) continue
        const quiet = operationQuietState(entry.view, at)
        if (quiet.state !== 'stuck' || !quiet.stageId || entry.stuckFlagged.has(quiet.stageId)) continue
        entry.stuckFlagged.add(quiet.stageId)
        appendLog(entry, 'warn', `No progress for ${Math.round(quiet.sinceProgressMs / 1000)}s — this step looks stuck`, quiet.stageId)
        changed(entry, 'milestone')
      }
    },

    shutdown() {
      for (const entry of entries.values()) {
        if (!entry.registered || isTerminal(entry.view.status)) continue
        appendLog(entry, 'warn', 'Server stopping')
        changed(entry, 'milestone')
      }
      stopQuietTimer()
    },

    dispose() {
      stopQuietTimer()
      for (const entry of entries.values()) if (entry.tickTimer) clearTimeout(entry.tickTimer)
    },
  }
  return registry
}
