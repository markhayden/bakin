/**
 * Engine-progress heartbeat — the input to the fast wedge watchdog.
 *
 * Every place the search engine OBSERVABLY does work stamps this: backfill
 * chunks landing, converge snapshots moving, outbox rows draining. While
 * migrations are in flight, a stale heartbeat means the engine wedged
 * under load (the 2026-07-22 soak signature: SendFailed storm, zero embed
 * batches, every backfill frozen at 0) — and the watchdog bounces it
 * instead of waiting on the doctor's 30-minute cadence.
 */

let lastProgressAt = Date.now()

export function noteSearchEngineProgress(): void {
  lastProgressAt = Date.now()
}

export function lastSearchEngineProgressAt(): number {
  return lastProgressAt
}

/** Test-only. */
export function resetSearchEngineProgressForTests(at?: number): void {
  lastProgressAt = at ?? Date.now()
}
