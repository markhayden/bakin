'use client'

import { useState, useEffect, useCallback } from 'react'

interface RuntimeStatus {
  restartNeeded: boolean
  restarting: boolean
  restart: () => Promise<void>
  markDirty: () => void
}

/**
 * Check if the active runtime needs a restart after config changes.
 * Shared across agent detail, models page, and team grid.
 */
export function useRuntimeStatus(): RuntimeStatus {
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    fetch('/api/plugins/models/runtime/status')
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime status: ${r.status}`)
        return r.json()
      })
      .then((data) => { if (data?.restartNeeded) setRestartNeeded(true) })
      .catch((e) => console.error('Failed to fetch runtime status:', e))
  }, [])

  const restart = useCallback(async () => {
    setRestarting(true)
    try {
      const res = await fetch('/api/plugins/models/runtime/restart', { method: 'POST' })
      if (res.ok) setRestartNeeded(false)
    } finally {
      setRestarting(false)
    }
  }, [])

  const markDirty = useCallback(() => setRestartNeeded(true), [])

  return { restartNeeded, restarting, restart, markDirty }
}
