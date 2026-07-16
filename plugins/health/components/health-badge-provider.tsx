'use client'

import type { NavBadge } from '@makinbakin/sdk'
import { useNavBadge } from '@makinbakin/sdk/hooks'
import { useHealthSummary } from '../hooks/use-health-summary'

/**
 * Background component (renders nothing) mounted via the host's
 * `nav-badge-providers` slot. Counts unique action/watch incidents (never raw
 * observations or advisories), using an urgent tone when any incident needs
 * action. Refresh rides the canonical report event—no cron or poll.
 */
export function HealthBadgeProvider() {
  const { count, tone } = useHealthSummary()

  const badge: NavBadge | null = count !== null && count > 0
    ? { count, tone }
    : null

  useNavBadge('health', 'health', badge)

  return null
}
