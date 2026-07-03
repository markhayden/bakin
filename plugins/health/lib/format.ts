/**
 * Pure formatters for the health dashboard.
 *
 * Extracted from components/health-page.tsx. (formatAge already comes from
 * @makinbakin/sdk/utils — not duplicated here.)
 */
import type { UsageEntry } from '../types'

export function formatUptime(since: string): string {
  const ms = Date.now() - new Date(since).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatRuntimeCost(value: number | null): string {
  if (value === null) return 'unavailable'
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function extractErrorMessage(entry: UsageEntry): string {
  const meta = entry.meta ?? {}
  if (typeof meta.error === 'string' && meta.error.length > 0) return meta.error
  if (typeof meta.httpStatus === 'number') {
    const method = typeof meta.method === 'string' ? `${meta.method} ` : ''
    return `${method}HTTP ${meta.httpStatus}`
  }
  return 'Error (no detail)'
}

export function formatActivity(entry: UsageEntry | null): string {
  if (!entry) return 'no activity'
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(entry.ts).getTime()) / 1000))
  if (ageSec >= 30) return `idle ${ageSec}s`
  if (entry.kind === 'mcp') return `calling ${entry.name.replace('bakin_exec_', '')} · ${ageSec}s ago`
  if (entry.kind === 'rest') return `handling ${entry.name} · ${ageSec}s ago`
  return `${entry.name} · ${ageSec}s ago`
}
