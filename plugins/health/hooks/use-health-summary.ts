'use client'

import { useHealthReport } from './use-health-report'

/** Navigation signals actionable alerts only; monitoring stays inside Health. */
export function useHealthSummary(): { count: number | null; tone: 'error' } {
  const { data } = useHealthReport()
  return {
    count: data ? new Set(data.incidents
      .filter((incident) => incident.effectiveDisposition === 'action_required' && incident.ackState === undefined)
      .map((incident) => incident.id)).size : null,
    tone: 'error',
  }
}
