/** Human-readable relative time from an ISO timestamp */
export function formatAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Human-readable absolute date+time with calendar awareness:
 * "Today 3:45 PM" / "Yesterday 9:02 AM" / "Jan 5 3:45 PM", carrying the year
 * only for prior-year timestamps (a bare "Jan 5" is ambiguous once runs and
 * completions outlive the calendar). Falls back to the raw input if unparseable.
 */
export function formatDateTime(timestamp: string): string {
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return timestamp
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 0) return `Today ${time}`
  if (diffDays === 1) return `Yesterday ${time}`
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`
}

/** Human-readable elapsed duration from a millisecond count ("850ms" / "42s" / "3m 5s"); null when undefined. */
export function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Human-readable file size */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Check if a heartbeat timestamp is stale (> 15 min) */
export function isStale(timestamp: string, thresholdMs = 15 * 60 * 1000): boolean {
  return Date.now() - new Date(timestamp).getTime() > thresholdMs
}
