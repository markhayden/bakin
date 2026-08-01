/** Compact relative timestamp for conversation surfaces. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Locale-formatted full timestamp for supplemental labels and tooltips. */
export function formatAbsoluteTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  return new Date(then).toLocaleString()
}

/** Locale-formatted calendar date for conversation day separators. */
export function formatDayLabel(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Local calendar-day key used to decide where separators belong. */
export function dayKey(iso: string | undefined): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  return `${then.getFullYear()}-${then.getMonth()}-${then.getDate()}`
}
