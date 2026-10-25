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
 */
import { useEffect } from 'react'

/** incident id → the check ids its evidence came from */
const armed = new Map<string, string[]>()

export function armHandoffReturn(incidentId: string, checkIds: readonly string[]): void {
  armed.set(incidentId, [...new Set(checkIds)])
}

/** A terminal that failed to open hands nothing off — disarm so no phantom rerun fires. */
export function disarmHandoffReturn(incidentId: string): void {
  armed.delete(incidentId)
}

export function isHandoffReturnArmed(incidentId: string): boolean {
  return armed.has(incidentId)
}

/** The union of check ids every armed handoff would rerun (test seam + page copy). */
export function armedHandoffChecks(): string[] {
  return [...new Set([...armed.values()].flat())]
}

/** Test seam. */
export function resetHandoffReturnForTests(): void {
  armed.clear()
}

/** Page-level: `onReturn(checkIds)` runs once per arming, when the operator is back on this page. */
export function useHandoffReturn(onReturn: (checkIds: string[]) => void): void {
  useEffect(() => {
    const fire = () => {
      if (armed.size === 0) return
      const checkIds = armedHandoffChecks()
      armed.clear()
      onReturn(checkIds)
    }
    fire() // mounting again IS the return when the handoff navigated away
    const onVisible = () => { if (document.visibilityState === 'visible') fire() }
    window.addEventListener('focus', fire)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', fire)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [onReturn])
}
