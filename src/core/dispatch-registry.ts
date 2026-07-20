/**
 * The in-flight dispatch turn registry — a LEAF module (imports only types +
 * logger) so non-dispatch code can reach the abort surface without pulling
 * in the dispatch fire-core. task-store.deleteTask and the watchdog orphan
 * sweep import from here; a task-store → dispatch-turns edge would cycle
 * (dispatch-turns imports task-store for board moves).
 *
 * Sends are fired and tracked, never awaited inside the dispatch cycle: one
 * 10-minute turn must not stall dispatching to every other agent. The
 * registry is advisory — caps + settle bookkeeping — never a source of
 * truth for task state; restart safety is unchanged (in-flight promises die
 * with the process, restart-recovery handles orphaned inProgress tasks via
 * heartbeats and the ledger boot sweep).
 */
import { createLogger } from './logger'
import type { InFlightTurn, InFlightTurnSnapshot, TurnAbortReason } from './dispatch-types'

const log = createLogger('dispatch-registry')

/**
 * Keyed by threadId (== the ledger run id), NOT the task marker: a
 * superseded-then-refired task briefly holds TWO live attempts under one
 * marker, and marker keying let the zombie's settle delete the live turn's
 * entry — uncounted, unabortable, untapped (same-agent-concurrency D3).
 * Aborted-but-unsettled entries still count toward the concurrency gate: a
 * transient double-count that self-resolves at settle, and the safe choice
 * on serialized runtimes where an early-freed slot would mean two turns in
 * one shared workspace.
 */
const inFlightTurns = new Map<string, InFlightTurn>()

/**
 * A force-released orphan turn gets this long after its abort fired to
 * settle on its own before the watchdog drops the registry entry (#604).
 */
export const ORPHAN_TURN_FORCE_RELEASE_GRACE_MS = 60_000

/** Registration is owned by fireDispatchTurn (dispatch-turns). */
export function registerTurn(turn: InFlightTurn): void {
  inFlightTurns.set(turn.threadId, turn)
}

/** Deletes only the caller's own attempt — threadIds are per-attempt unique. */
export function unregisterTurn(threadId: string): void {
  inFlightTurns.delete(threadId)
}

export function getInFlightTurnCount(agentId?: string): number {
  if (!agentId) return inFlightTurns.size
  let count = 0
  for (const turn of inFlightTurns.values()) {
    if (turn.agentId === agentId) count += 1
  }
  return count
}

/** Settle chains of every tracked turn — awaitDispatchIdle's wait set. */
export function getInFlightSettledPromises(): Promise<void>[] {
  return [...inFlightTurns.values()].map((turn) => turn.settled)
}

/** The entry for a threadId, if still registered (tap + clobber lookups). */
export function getInFlightTurn(threadId: string): InFlightTurn | undefined {
  return inFlightTurns.get(threadId)
}

/**
 * Fire the abort controller of every in-flight turn belonging to `taskId`
 * (regular markers and `taskId:stepId` workflow-step markers alike). A
 * nested-workflow step turn is registered under the PARENT task but serves a
 * child board task (`childTaskId`) — deleting either one aborts it.
 * Idempotent per turn — abortedAt is the guard. Returns the number of turns
 * newly aborted. The 'aborted' settle branch in fireDispatchTurn does the
 * audit/bookkeeping when the rejection lands.
 */
export function abortTurnsForTask(taskId: string, reason: TurnAbortReason): number {
  let count = 0
  for (const turn of inFlightTurns.values()) {
    if ((turn.taskId !== taskId && turn.childTaskId !== taskId) || turn.abortedAt) continue
    turn.abortedAt = Date.now()
    turn.abortReason = reason
    turn.abort.abort(reason)
    count += 1
  }
  if (count > 0) log.info('Aborted in-flight turn(s) for task', { taskId, reason, count })
  return count
}

/** Advisory view of the registry for the watchdog orphan sweep and tests. */
export function getInFlightTurnsSnapshot(): InFlightTurnSnapshot[] {
  return [...inFlightTurns.values()].map((turn) => ({
    marker: turn.marker,
    agentId: turn.agentId,
    taskId: turn.taskId,
    ...(turn.childTaskId ? { childTaskId: turn.childTaskId } : {}),
    threadId: turn.threadId,
    startedAt: turn.startedAt,
    ...(turn.abortedAt ? { abortedAt: turn.abortedAt } : {}),
  }))
}

/**
 * Drop a registry entry outright, freeing the agent's dispatch slot. ONLY
 * for the watchdog's orphan sweep, after an abort + grace period failed to
 * settle the turn — the registry is advisory, so a hung provider turn must
 * not hold the slot forever. If the zombie send ever settles, its handlers
 * run normally (settleRun/audit are idempotent; unregister is a no-op).
 */
export function forceReleaseTurn(threadId: string): boolean {
  return inFlightTurns.delete(threadId)
}
