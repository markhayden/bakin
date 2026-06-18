/**
 * The `.dispatch-state.json` layer: the async mutex that serializes every
 * read/write, the file load/save, dispatch-marker helpers, and failure-record
 * accessors. Extracted from dispatch.ts so the state file format + its lock
 * live in ONE module.
 *
 * `stateQueue` is the single dispatch-state mutex instance — every caller
 * (the cycle loop, single dispatch, and fireDispatchTurn's settle handlers)
 * imports `withStateLock` from HERE so they all serialize on the same lock.
 * Do not declare a second `stateQueue` anywhere.
 *
 * The state file path + the `dispatchSeq`/`dispatched`/`failedDispatches` shape
 * are a cross-package contract (packages/core/src/execution/ledger.ts reads the
 * file directly for its seq-watermark migration) — do not rename or reshape.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import type { DispatchState, FailureRecord } from './dispatch-types'

const log = createLogger('dispatch-state')

// Async mutex for .dispatch-state.json — serializes all reads/writes.
let stateQueue = Promise.resolve() as Promise<unknown>
export function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = stateQueue.then(fn, fn) as Promise<T>
  stateQueue = next.then(() => {}, () => {})
  return next
}

export function getStateFile(contentDir: string): string {
  return join(contentDir, '.dispatch-state.json')
}

export function getFailureRecord(entry: FailureRecord | undefined): FailureRecord | null {
  if (!entry) return null
  return { ...entry, kind: entry.kind ?? 'structural' }
}

export function cooldownForFailure(
  failure: FailureRecord,
  settings: { dispatch: { transientCooldownMs: number; failureCooldownMs: number } },
): number {
  return failure.kind === 'transient'
    ? settings.dispatch.transientCooldownMs
    : settings.dispatch.failureCooldownMs
}

export function getDispatchMarkerTaskId(marker: string): string {
  const separator = marker.indexOf(':')
  return separator === -1 ? marker : marker.slice(0, separator)
}

export function removeDispatchMarkersForTask(
  state: DispatchState,
  dispatchedSet: Set<string> | null,
  taskId: string,
): void {
  state.dispatched = state.dispatched.filter(marker => getDispatchMarkerTaskId(marker) !== taskId)
  if (dispatchedSet) {
    for (const marker of Array.from(dispatchedSet)) {
      if (getDispatchMarkerTaskId(marker) === taskId) dispatchedSet.delete(marker)
    }
  }
}

export function trimDispatched(state: DispatchState, maxDispatched: number): void {
  if (state.dispatched.length > maxDispatched) {
    state.dispatched = state.dispatched.slice(-maxDispatched)
  }
}

export function loadDispatchState(contentDir: string): DispatchState {
  const stateFile = getStateFile(contentDir)
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (!Array.isArray(parsed.dispatched)) parsed.dispatched = []
      if (!parsed.failedDispatches || typeof parsed.failedDispatches !== 'object') parsed.failedDispatches = {}
      return parsed
    }
  } catch (err) {
    log.warn('Failed to read dispatch state', err)
  }
  return { lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {} }
}

export function saveDispatchState(contentDir: string, state: DispatchState): void {
  writeFileSync(getStateFile(contentDir), JSON.stringify(state, null, 2), 'utf-8')
}

export async function clearDispatchMarker(contentDir: string, taskId: string): Promise<void> {
  await withStateLock(() => {
    const state = loadDispatchState(contentDir)
    removeDispatchMarkersForTask(state, null, taskId)
    saveDispatchState(contentDir, state)
  })
}
