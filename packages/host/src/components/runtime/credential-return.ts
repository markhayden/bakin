/**
 * Return verification for the runtime page's credential handoff (Codex r3
 * R3-5): a successful copy ARMS the originating Health check ids here —
 * outside the component, so a trip to the Terminal route and back still
 * verifies — and the credentials group reruns exactly those checks on the
 * next mount / focus / visibility, then re-reads its reports. One-shot per
 * arming; nothing reruns without a handoff having been taken.
 */
import { useEffect } from 'react'

const armed = new Set<string>()

export function armCredentialReturn(checkIds: readonly string[]): void {
  for (const id of checkIds) armed.add(id)
}

export function armedCredentialReturn(): string[] {
  return [...armed]
}

/** Test seam. */
export function resetCredentialReturnForTests(): void {
  armed.clear()
}

/** `onReturn(checkIds)` runs once per arming when the operator is back on the page. */
export function useCredentialReturn(onReturn: (checkIds: string[]) => void): void {
  useEffect(() => {
    const fire = () => {
      if (armed.size === 0) return
      const checkIds = [...armed]
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
