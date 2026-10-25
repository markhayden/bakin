/**
 * Return verification for the roster panel's registry handoffs (Codex r4
 * R4-2): a successful copy ARMS the targeted roster recheck here — outside
 * the panel, so a trip to the Terminal route and back still verifies — and
 * the panel consumes it once on mount / focus / visibility. Nothing reruns
 * without a handoff having been taken.
 */
import { useEffect } from 'react'

let armed = false

export function armRosterReturn(): void {
  armed = true
}

export function isRosterReturnArmed(): boolean {
  return armed
}

/** Test seam. */
export function resetRosterReturnForTests(): void {
  armed = false
}

export function useRosterReturn(onReturn: () => void): void {
  useEffect(() => {
    const fire = () => {
      if (!armed) return
      armed = false
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
