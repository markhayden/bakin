'use client'

import { useCallback, useEffect, useState } from 'react'
import { useContentStore } from '@makinbakin/sdk/hooks'

interface HealthSummaryResponse {
  doctor: { summary?: { errors?: number; warnings?: number; total?: number } } | null
}

interface UseHealthSummaryResult {
  errors: number | null
}

/**
 * Count of failing (`status: 'error'`) doctor checks for the Health nav
 * badge. Reads the existing `/summary` aggregate (cheap, in-memory) and
 * refetches whenever the SSE-driven `doctorVersion` bumps — i.e. on every
 * `doctor.run` (startup / watchdog interval / on-demand). No new EventSource,
 * no poll. `errors` is null until the first load.
 */
export function useHealthSummary(): UseHealthSummaryResult {
  const [errors, setErrors] = useState<number | null>(null)
  const doctorVersion = useContentStore((s) => s.doctorVersion)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/plugins/health/summary')
      if (!response.ok) throw new Error(`Failed to load health summary (${response.status})`)
      const data = await response.json() as HealthSummaryResponse
      setErrors(data.doctor?.summary?.errors ?? 0)
    } catch (err) {
      // Keep the last good value; the next doctor.run retries. Log at debug
      // so a persistently-failing summary is diagnosable without noise.
      console.debug('[health] nav-badge summary fetch failed', err)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, doctorVersion])

  return { errors }
}
