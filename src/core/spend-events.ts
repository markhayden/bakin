/**
 * Leaf seam between spend WRITES and the spend observer. `recordSpend`
 * (agent-cost) announces that spend moved; the observer subscribes when it
 * loads (boot wires it). A leaf so the metering path never imports the
 * observer graph (budget-notify → relay → metering would close a cycle).
 */
type Listener = () => void

const g = globalThis as typeof globalThis & { __bakinSpendListeners?: Set<Listener> }
function listeners(): Set<Listener> {
  g.__bakinSpendListeners ??= new Set()
  return g.__bakinSpendListeners
}

/** Subscribe to "spend was recorded"; returns the unsubscribe. */
export function onSpendRecorded(listener: Listener): () => void {
  listeners().add(listener)
  return () => listeners().delete(listener)
}

/** Announce a spend write. Listener failures never reach the writer. */
export function emitSpendRecorded(): void {
  for (const listener of listeners()) {
    try {
      listener()
    } catch {
      // The observer logs its own failures; the writer must not care.
    }
  }
}
