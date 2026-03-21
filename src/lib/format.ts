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

/** Check if a heartbeat timestamp is stale (> 15 min) */
export function isStale(timestamp: string, thresholdMs = 15 * 60 * 1000): boolean {
  return Date.now() - new Date(timestamp).getTime() > thresholdMs
}
