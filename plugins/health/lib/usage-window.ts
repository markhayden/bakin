const DAY_MS = 24 * 60 * 60 * 1_000

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(value) ? Math.floor(value / DAY_MS) : null
}

/**
 * Human-readable scope for day-aligned usage data.
 *
 * The API windows are elapsed-time windows, then widened to every local
 * calendar day they touch. That usually makes 24h "Today + yesterday", but a
 * daylight-saving transition can touch three dates. Derive the label from the
 * evidence instead of promising a fixed number of calendar days.
 */
export function usageWindowScopeLabel(since: string, throughDay: string): string {
  const start = dayNumber(since)
  const end = dayNumber(throughDay)
  if (start === null || end === null || end < start) return `${since} through ${throughDay}`

  const calendarDays = end - start + 1
  if (calendarDays === 1) return 'Today'
  if (calendarDays === 2) return 'Today + yesterday'
  return `${calendarDays} calendar days`
}
