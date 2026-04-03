'use client'

import { useState, useEffect, useCallback } from 'react'

interface GatewayStatus {
  restartNeeded: boolean
  restarting: boolean
  restart: () => Promise<void>
  markDirty: () => void
}

/**
 * Check if the OpenClaw gateway needs a restart (config out of sync).
 * Shared across agent detail, models page, team grid.
 */
export function useGatewayStatus(): GatewayStatus {
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    fetch('/api/plugins/models/gateway/status')
      .then((r) => r.json())
      .then((data) => { if (data.restartNeeded) setRestartNeeded(true) })
      .catch(() => {})
  }, [])

  const restart = useCallback(async () => {
    setRestarting(true)
    try {
      const res = await fetch('/api/plugins/models/gateway/restart', { method: 'POST' })
      if (res.ok) setRestartNeeded(false)
    } finally {
      setRestarting(false)
    }
  }, [])

  const markDirty = useCallback(() => setRestartNeeded(true), [])

  return { restartNeeded, restarting, restart, markDirty }
}
