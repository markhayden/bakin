'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { HealthReport, NavBadgeTone } from '@makinbakin/sdk'

interface UseHealthSummaryResult {
  count: number | null
  tone: Extract<NavBadgeTone, 'error' | 'attention'>
}

/**
 * Unique non-advisory incident count for the Health nav badge. The canonical
 * cached report is cheap to project and is refreshed through the shell's one
 * plugin-event connection; this hook opens no EventSource and does not poll.
 */
export function useHealthSummary(): UseHealthSummaryResult {
  const [state, setState] = useState<UseHealthSummaryResult>({ count: null, tone: 'attention' })

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/plugins/health/doctor')
      if (!response.ok) throw new Error(`Failed to load health summary (${response.status})`)
      const report = await response.json() as HealthReport
      const incidents = report.incidents.filter((incident) => incident.disposition !== 'advisory')
      setState({
        count: incidents.length,
        tone: incidents.some((incident) => incident.disposition === 'action_required') ? 'error' : 'attention',
      })
    } catch (err) {
      // Keep the last good value; the next report event retries. Log at debug
      // so a persistently-failing summary is diagnosable without noise.
      console.debug('[health] nav-badge summary fetch failed', err)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  usePluginEvent('health.report.changed', refresh)

  return state
}
