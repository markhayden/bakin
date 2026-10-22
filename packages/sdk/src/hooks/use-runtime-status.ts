'use client'

import { useState, useEffect, useCallback } from 'react'

export interface RestartAdviceWire {
  needed: boolean
  title?: string
  body?: string
  action?: { label: string; kind: 'restart-runtime' }
}

export interface RuntimeStatus {
  /** A config change is waiting on a runtime restart (adapter-advised, persisted server-side). */
  pending: boolean
  /** What to render: the adapter's own title/body/action, or the generic fallback. */
  advice: RestartAdviceWire
  restarting: boolean
  /** The last restart attempt's failure, when the banner is retained because of it. */
  lastError: string | null
  restart: () => Promise<void>
  /** Re-read server state after a save — the SERVER decides whether a restart is pending. */
  refresh: () => Promise<void>
}

const NONE: RestartAdviceWire = { needed: false }

/**
 * Pending-restart status for the active runtime (#878): the banner is a
 * dumb renderer of what the adapter said. Shared by the Models page, agent
 * detail and the team grid. Never set optimistically on the client — a
 * save calls `refresh()` and the server answers from persisted state.
 */
export function useRuntimeStatus(): RuntimeStatus {
  const [pending, setPending] = useState(false)
  const [advice, setAdvice] = useState<RestartAdviceWire>(NONE)
  const [lastError, setLastError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/plugins/models/runtime/status')
      if (!r.ok) throw new Error(`Runtime status: ${r.status}`)
      const data = (await r.json()) as { pending?: boolean; advice?: RestartAdviceWire; lastAttempt?: { ok: boolean; error?: string } | null }
      setPending(data.pending === true)
      setAdvice(data.advice ?? NONE)
      setLastError(data.lastAttempt && !data.lastAttempt.ok ? (data.lastAttempt.error ?? 'restart failed') : null)
    } catch (e) {
      console.error('Failed to fetch runtime status:', e)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const restart = useCallback(async () => {
    setRestarting(true)
    try {
      await fetch('/api/plugins/models/runtime/restart', { method: 'POST' })
    } finally {
      setRestarting(false)
      await refresh()
    }
  }, [refresh])

  return { pending, advice, restarting, lastError, restart, refresh }
}
