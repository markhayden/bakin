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
