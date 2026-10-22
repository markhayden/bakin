/**
 * Browser half of self-update verification (#1007 D7.11): once the restart
 * handoff is known (`{ expectedVersion, oldBootId }`), poll the server until
 * a new boot serves the expected version and report the outcome. Idle until
 * given a handoff; a changed handoff restarts the verification.
 */
import { useEffect, useState } from 'react'
import { describeSelfUpdateVerification, verifySelfUpdate, type SelfUpdateVerification } from '@bakin/core/install-core/self-update-verify'

export interface SelfUpdateHandoff {
  expectedVersion: string
  oldBootId: string
}

export type SelfUpdateVerificationState =
  | { status: 'idle' }
  | { status: 'verifying'; handoff: SelfUpdateHandoff }
  | ({ handoff: SelfUpdateHandoff; summary: string } & SelfUpdateVerification)

export function useSelfUpdateVerification(handoff: SelfUpdateHandoff | null, opts: { timeoutMs?: number; pollMs?: number } = {}): SelfUpdateVerificationState {
  const [state, setState] = useState<SelfUpdateVerificationState>({ status: 'idle' })
  // The handoff identity (not the object) decides when a verification starts.
  const key = handoff ? `${handoff.oldBootId}\u0000${handoff.expectedVersion}` : null
  const [seenKey, setSeenKey] = useState<string | null>(null)
  if (seenKey !== key) {
    setSeenKey(key)
    setState(handoff ? { status: 'verifying', handoff } : { status: 'idle' })
  }
  useEffect(() => {
    if (!handoff) return
    const controller = new AbortController()
    const current = { ...handoff }
    verifySelfUpdate({
      expectedVersion: current.expectedVersion,
      oldBootId: current.oldBootId,
      fetch: (url, init) => fetch(url, { cache: 'no-store', signal: init?.signal }),
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
      signal: controller.signal,
    }).then((verification) => {
      if (controller.signal.aborted) return
      setState({ ...verification, handoff: current, summary: describeSelfUpdateVerification(verification) })
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handoff is keyed by identity above; options are read once per handoff
  }, [key])
  return state
}
