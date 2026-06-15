'use client'

import type { NavBadge } from '@makinbakin/sdk'
import { useNavBadge } from '@makinbakin/sdk/hooks'
import { useHealthSummary } from '../hooks/use-health-summary'

/**
 * Background component (renders nothing) mounted via the host's
 * `nav-badge-providers` slot. Shows a red `error` count on the Health nav
 * item when doctor reports ≥1 failing check, cleared otherwise (bakin
 * #265). Errors only — warnings are often steady-state per install and
 * would make the badge permanent noise. Refresh rides the `doctor.run`
 * SSE signal — no cron, heartbeat, or poll.
 */
export function HealthBadgeProvider() {
  const { errors } = useHealthSummary()

  const badge: NavBadge | null = errors !== null && errors > 0
    ? { count: errors, tone: 'error' }
    : null

  useNavBadge('health', 'health', badge)

  return null
}
