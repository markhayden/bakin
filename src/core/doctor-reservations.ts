/**
 * Incident reservations (#896, spec D3.1): admission BEFORE ownership.
 *
 * A synchronous, in-process check-and-set over `incidentId → ownerToken`,
 * taken before `startOperation` by every repair apply path (UI, approval,
 * escalation, Discord — all enter `startDoctorRepair`), by manual delegation
 * before it creates a task, and by escalation for the span of its planning.
 * The operation registry owns the lifetime of the WORK; this map only decides
 * who may start it, so two different repairs — or a repair and a delegation —
 * can never work the same incident at once, while identical requests still
 * attach exactly as the registry attaches them (a repair's owner token IS its
 * operation fingerprint).
 *
 * Not durable on purpose: a restart drops every reservation and startup
 * recovery re-judges from fresh state. One server process = one map.
 */
import { createLogger } from './logger'

const log = createLogger('doctor-reservations')

export type ReservationResult =
  /** Every id was free; the owner now holds them all. */
  | { status: 'granted' }
  /** The SAME owner already held every overlapping id (the free ones were added). */
  | { status: 'attached' }
  /** Another owner holds at least one id; NOTHING was reserved. */
  | { status: 'refused'; overlapping: string[]; heldBy: string }

const held = new Map<string, string>()

export function reserveIncidents(ids: readonly string[], owner: string): ReservationResult {
  const overlapping: string[] = []
  let heldBy: string | null = null
  let attached = false
  for (const id of ids) {
    const current = held.get(id)
    if (current === undefined) continue
    if (current === owner) { attached = true; continue }
    overlapping.push(id)
    heldBy ??= current
  }
  if (overlapping.length > 0) {
    log.info('Incident reservation refused — already held', { owner, heldBy, overlapping })
    return { status: 'refused', overlapping, heldBy: heldBy! }
  }
  for (const id of ids) held.set(id, owner)
  return attached ? { status: 'attached' } : { status: 'granted' }
}

/**
 * Moves ids from one owner to another in one step. Returns false (and moves
 * nothing) when the source does not hold every id.
 */
export function transferIncidents(ids: readonly string[], from: string, to: string): boolean {
  if (!ids.every((id) => held.get(id) === from)) return false
  for (const id of ids) held.set(id, to)
  return true
}

/** Releases the given ids (or everything) the owner holds; ids held by others are untouched. */
export function releaseIncidents(owner: string, ids?: readonly string[]): void {
  const targets = ids ?? [...held.entries()].filter(([, o]) => o === owner).map(([id]) => id)
  for (const id of targets) if (held.get(id) === owner) held.delete(id)
}

/** Every incident currently reserved by anyone. */
export function heldIncidentIds(): ReadonlySet<string> {
  return new Set(held.keys())
}

/** Who holds an incident, if anyone. */
export function incidentHolder(id: string): string | undefined {
  return held.get(id)
}

export function resetIncidentReservationsForTests(): void {
  held.clear()
}
