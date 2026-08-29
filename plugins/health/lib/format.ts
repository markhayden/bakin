/**
 * Pure formatters for the health dashboard.
 *
 * Extracted from components/health-page.tsx. (formatAge already comes from
 * @makinbakin/sdk/utils — not duplicated here.)
 */
import { formatTokenCount } from '@makinbakin/sdk/conversation'
import { formatDuration } from '@makinbakin/sdk/utils'

/** Elapsed time since `since`, via the SDK duration helper (sub-second uptime reads as "850ms"). */
export function formatUptime(since: string): string {
  return formatDuration(Math.max(0, Date.now() - Date.parse(since))) ?? '—'
}

/** Compact token count — the SDK conversation helper (890, 14.2k, 1.2m). */
export { formatTokenCount }

export function formatRuntimeCost(value: number | null): string {
  if (value === null) return 'unavailable'
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}
