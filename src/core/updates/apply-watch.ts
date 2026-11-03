/**
 * Completion watches for applied updates (#1007 review r3 #7): ONE
 * subscription per operation id (attachments and retries merge their subject
 * ids into it), fired once when the operation SUCCEEDS, dropped on any
 * terminal state, and disposed with the updates service — a stuck operation
 * never accumulates listeners.
 */
import type { OperationView } from '@makinbakin/sdk/types'

interface Watch {
  ids: Set<string>
  unsubscribe: () => void
}

const watches = new Map<string, Watch>()

export interface ApplyWatchRegistry {
  get: (operationId: string) => OperationView | null
  subscribe: (listener: (view: OperationView) => void) => () => void
}

/** Watch `operationId`; `onSucceeded` receives the union of every subject id registered for it. */
export function watchOperationSucceeded(registry: ApplyWatchRegistry, operationId: string, ids: readonly string[], onSucceeded: (ids: string[]) => void): void {
  const existing = watches.get(operationId)
  if (existing) {
    for (const id of ids) existing.ids.add(id)
    return
  }
  const watch: Watch = { ids: new Set(ids), unsubscribe: () => {} }
  const settle = (view: OperationView | null): boolean => {
    if (!view) return false
    if (view.status === 'succeeded') {
      dispose(operationId)
      onSucceeded([...watch.ids])
      return true
    }
    if (view.status === 'failed' || view.status === 'cancelled') {
      dispose(operationId)
      return true
    }
    return false
  }
  watches.set(operationId, watch)
  watch.unsubscribe = registry.subscribe((view) => { if (view.id === operationId) settle(view) })
  // Attached to one that already finished: no event will come.
  settle(registry.get(operationId))
}

function dispose(operationId: string): void {
  const watch = watches.get(operationId)
  if (!watch) return
  watches.delete(operationId)
  watch.unsubscribe()
}

/** Every watch, dropped (the updates service is stopping). */
export function disposeApplyWatches(): void {
  for (const id of [...watches.keys()]) dispose(id)
}

/** Test seam: the operation ids currently watched. */
export function watchedOperationIds(): string[] {
  return [...watches.keys()]
}
