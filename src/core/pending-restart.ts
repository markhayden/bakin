/**
 * Pending-restart state (#878 Models half, D30): WHICH config changes are
 * still waiting on a runtime restart, persisted so a page reload or server
 * restart cannot lose (or invent) a needed banner.
 *
 * The adapter decides whether a change kind needs a restart at all
 * (`runtime.restartAdvice(kind)`): Pi answers needed:false for everything,
 * OpenClaw only for roster changes. An adapter that omits the member gets
 * the conservative generic advice. A record is cleared ONLY by a successful
 * `restart()`; a failed attempt is recorded and the banner stays.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter, RestartAdvice, RuntimeConfigChangeKind } from '@bakin/core/adapters/runtime'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'

const log = createLogger('pending-restart')

export interface PendingRestartState {
  kinds: RuntimeConfigChangeKind[]
  since: number
  lastAttempt?: { at: number; ok: boolean; error?: string }
}

export interface RestartStatus {
  pending: boolean
  kinds: RuntimeConfigChangeKind[]
  since: number | null
  /** What the banner renders — the adapter's words, or the generic fallback. */
  advice: RestartAdvice
  /** True when the adapter omits restartAdvice() and the generic advice is in use. */
  generic: boolean
  lastAttempt: PendingRestartState['lastAttempt'] | null
}

export const GENERIC_RESTART_ADVICE: RestartAdvice = {
  needed: true,
  title: 'Runtime config changed',
  body: "Your saved settings are retained. If agents don't pick them up, restart the runtime.",
  action: { label: 'Restart runtime', kind: 'restart-runtime' },
}

function statePath(): string {
  return join(getContentDir(), 'plugin-settings', 'models', 'pending-restart.json')
}

export function readPendingRestart(): PendingRestartState | null {
  const file = statePath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PendingRestartState
    return Array.isArray(parsed.kinds) && parsed.kinds.length > 0 ? parsed : null
  } catch (err) {
    log.warn('pending-restart.json unreadable; treating as none pending', { error: String(err) })
    return null
  }
}

function writeState(state: PendingRestartState | null): void {
  const file = statePath()
  if (!state) {
    if (existsSync(file)) unlinkSync(file)
    return
  }
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

/** The adapter's advice for a change kind, or the generic fallback when the member is absent. */
export function adviceFor(runtime: Pick<AgentRuntimeAdapter, 'restartAdvice'>, kind: RuntimeConfigChangeKind): { advice: RestartAdvice; generic: boolean } {
  const member = runtime.restartAdvice
  if (!member) return { advice: GENERIC_RESTART_ADVICE, generic: true }
  try {
    const advice = member.call(runtime, kind)
    return advice ? { advice, generic: false } : { advice: { needed: false }, generic: false }
  } catch (err) {
    log.warn('restartAdvice() threw; using generic advice', { kind, error: String(err) })
    return { advice: GENERIC_RESTART_ADVICE, generic: true }
  }
}

/**
 * Record that changes of these kinds landed. Only kinds the adapter says
 * need a restart are recorded — Pi never accumulates anything.
 */
export function notePendingChange(runtime: Pick<AgentRuntimeAdapter, 'restartAdvice'>, kinds: RuntimeConfigChangeKind[]): void {
  const needed = kinds.filter((kind) => adviceFor(runtime, kind).advice.needed)
  if (needed.length === 0) return
  const current = readPendingRestart()
  const merged = [...new Set([...(current?.kinds ?? []), ...needed])]
  writeState({ kinds: merged, since: current?.since ?? Date.now(), ...(current?.lastAttempt ? { lastAttempt: current.lastAttempt } : {}) })
}

/** A successful restart is the ONLY thing that clears pending state. */
export function clearPendingRestart(): void {
  writeState(null)
}

/** A failed restart keeps the record and notes the failure for the banner. */
export function recordRestartFailure(err: unknown): void {
  const current = readPendingRestart()
  if (!current) return
  writeState({ ...current, lastAttempt: { at: Date.now(), ok: false, error: err instanceof Error ? err.message : String(err) } })
}

export function describeRestart(runtime: Pick<AgentRuntimeAdapter, 'restartAdvice'>): RestartStatus {
  const state = readPendingRestart()
  if (!state) {
    return { pending: false, kinds: [], since: null, advice: { needed: false }, generic: !runtime.restartAdvice, lastAttempt: null }
  }
  // The banner shows the first pending kind's advice; roster (a gateway
  // restart) outranks the softer kinds when several are pending.
  const order: RuntimeConfigChangeKind[] = ['roster', 'model-config', 'routing-policy']
  const lead = order.find((k) => state.kinds.includes(k)) ?? state.kinds[0]!
  const { advice, generic } = adviceFor(runtime, lead)
  return { pending: true, kinds: state.kinds, since: state.since, advice: advice.needed ? advice : GENERIC_RESTART_ADVICE, generic, lastAttempt: state.lastAttempt ?? null }
}
