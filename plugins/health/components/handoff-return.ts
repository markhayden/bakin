/**
 * Return verification for a Health handoff (self-healing PR1 slice 1.4c,
 * plan task 1.4c: "a targeted rerun of the originating check when the
 * session ends or the page regains focus"). When the operator takes a
 * command — opens it in a Terminal session or copies it — the incident is
 * ARMED here with the ids of the checks that raised it, outside any row:
 * the row that armed it unmounts when the Terminal route opens, and a copy
 * never fires a DOM event the row could see. The Health page owns the other
 * half: `useHandoffReturn` hands the armed check ids to its targeted rerun
 * when the operator comes back — the page mounting again (back from
 * `/terminal/…`), the window regaining focus (back from their own shell) or
 * the tab becoming visible. One-shot per arming; nothing reruns without a
 * handoff having been taken. (The Terminal plugin publishes no session-exit
 * event, so "session end" is observed as the return itself.)
 *
 * The mechanism is the SDK's (`handoffReturnChannel` / `useHandoffReturn`
 * in `@makinbakin/sdk/hooks`); this file is Health's own channel on it, so
 * another page coming back never spends Health's recheck.
 */
import { handoffReturnChannel, useHandoffReturn as useChannelReturn } from '@makinbakin/sdk/hooks'

const CONSUMER = 'health'
const channel = handoffReturnChannel(CONSUMER)

/** incident id → the check ids its evidence came from */
export function armHandoffReturn(incidentId: string, checkIds: readonly string[]): void {
  channel.arm(incidentId, checkIds)
}

/** A terminal that failed to open hands nothing off — disarm so no phantom rerun fires. */
export function disarmHandoffReturn(incidentId: string): void {
  channel.disarm(incidentId)
}

export function isHandoffReturnArmed(incidentId: string): boolean {
  return channel.isArmed(incidentId)
}

/** The union of check ids every armed handoff would rerun (test seam + page copy). */
export function armedHandoffChecks(): string[] {
  return channel.armedTokens()
}

/** Page-level: `onReturn(checkIds)` runs once per arming, when the operator is back on this page. */
export function useHandoffReturn(onReturn: (checkIds: string[]) => void): void {
  useChannelReturn(CONSUMER, onReturn)
}
