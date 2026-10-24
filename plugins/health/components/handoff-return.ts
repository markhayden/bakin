/**
 * Return verification for a Health handoff (self-healing PR1 slice 1.4c).
 * When the operator takes a command — opens it in a Terminal session or
 * copies it — the incident is ARMED here, outside any row: the row that
 * armed it unmounts when the Terminal route opens, and a copy never fires a
 * DOM event the row could see. The Health page owns the other half:
 * `useHandoffReturn` reruns the checks when the operator comes back — the
 * page mounting again (back from `/terminal/…`), the window regaining focus
 * (back from their own shell) or the tab becoming visible. One-shot per
 * arming; nothing reruns without a handoff having been taken.
 */
import { useEffect } from 'react'

const armed = new Set<string>()

export function armHandoffReturn(incidentId: string): void {
  armed.add(incidentId)
}

/** A terminal that failed to open hands nothing off — disarm so no phantom rerun fires. */
export function disarmHandoffReturn(incidentId: string): void {
  armed.delete(incidentId)
}

export function isHandoffReturnArmed(incidentId: string): boolean {
  return armed.has(incidentId)
}

/** Test seam. */
export function resetHandoffReturnForTests(): void {
  armed.clear()
}

/** Page-level: `onReturn` runs once per arming, when the operator is back on this page. */
export function useHandoffReturn(onReturn: () => void): void {
  useEffect(() => {
    const fire = () => {
      if (armed.size === 0) return
      armed.clear()
      onReturn()
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
