/**
 * Natural language → cron expression parser.
 * Deterministic regex-based parser for common patterns.
 * Falls back to LLM if no match.
 */
import type { ParseResult } from '../types'

// ---------------------------------------------------------------------------
// Deterministic NL → cron patterns
// ---------------------------------------------------------------------------

const DAY_MAP: Record<string, string> = {
  sunday: '0', sun: '0',
  monday: '1', mon: '1',
  tuesday: '2', tue: '2',
  wednesday: '3', wed: '3',
  thursday: '4', thu: '4',
  friday: '5', fri: '5',
  saturday: '6', sat: '6',
}

const ALL_DAYS = Object.keys(DAY_MAP)

interface PatternRule {
  regex: RegExp
  build: (m: RegExpMatchArray) => string | null
  human: (m: RegExpMatchArray) => string
}

// Common timezone abbreviations to strip (cron is always server-local)
const TZ_SUFFIX = /\s+(?:mst|mdt|cst|cdt|est|edt|pst|pdt|utc|gmt|[a-z]{2,5}t)$/i

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  // "9am", "9:30am", "14:00", "2pm", "2:30pm", "noon", "midnight"
  // Strip trailing timezone if present (e.g. "9am MST" → "9am")
  const lower = timeStr.toLowerCase().trim().replace(TZ_SUFFIX, '')
  if (lower === 'noon') return { hour: 12, minute: 0 }
  if (lower === 'midnight') return { hour: 0, minute: 0 }

  const match12 = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (match12) {
    let hour = parseInt(match12[1], 10)
    const minute = match12[2] ? parseInt(match12[2], 10) : 0
    const period = match12[3]
    if (hour === 12) hour = period === 'am' ? 0 : 12
    else if (period === 'pm') hour += 12
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
  }

  const match24 = lower.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    const hour = parseInt(match24[1], 10)
    const minute = parseInt(match24[2], 10)
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
  }

  return null
}

function parseDays(dayStr: string): string[] | null {
  const parts = dayStr.toLowerCase().split(/(?:\s*,\s*|\s+and\s+)/)
  const days: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (DAY_MAP[trimmed] !== undefined) {
      days.push(DAY_MAP[trimmed])
    } else {
      return null
    }
  }
  return days.length > 0 ? days : null
}

const PATTERNS: PatternRule[] = [
  // "every N minutes"
  {
    regex: /^every\s+(\d+)\s+minutes?$/i,
    build: (m) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 59) return null
      return `*/${n} * * * *`
    },
    human: (m) => `Every ${m[1]} minutes`,
  },
  // "every N hours"
  {
    regex: /^every\s+(\d+)\s+hours?$/i,
    build: (m) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 23) return null
      return `0 */${n} * * *`
    },
    human: (m) => `Every ${m[1]} hours`,
  },
  // "every hour"
  {
    regex: /^every\s+hour$/i,
    build: () => '0 * * * *',
    human: () => 'Every hour',
  },
  // "every minute"
  {
    regex: /^every\s+minute$/i,
    build: () => '* * * * *',
    human: () => 'Every minute',
  },
  // Bare time: "10am", "9:30pm", "at 10am" → daily
  {
    regex: /^(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s+\w+)?)$/i,
    build: (m) => {
      const t = parseTime(m[1])
      if (!t) return null
      return `${t.minute} ${t.hour} * * *`
    },
    human: (m) => `Every day at ${m[1].replace(TZ_SUFFIX, '').trim()}`,
  },
  // "every day at TIME"
  {
    regex: /^every\s+day\s+at\s+(.+)$/i,
    build: (m) => {
      const t = parseTime(m[1])
      if (!t) return null
      return `${t.minute} ${t.hour} * * *`
    },
    human: (m) => `Every day at ${m[1]}`,
  },
  // "daily at TIME" (alias)
  {
    regex: /^daily\s+at\s+(.+)$/i,
    build: (m) => {
      const t = parseTime(m[1])
      if (!t) return null
      return `${t.minute} ${t.hour} * * *`
    },
    human: (m) => `Every day at ${m[1]}`,
  },
  // "every weekday at TIME"
  {
    regex: /^every\s+weekday\s+at\s+(.+)$/i,
    build: (m) => {
      const t = parseTime(m[1])
      if (!t) return null
      return `${t.minute} ${t.hour} * * 1-5`
    },
    human: (m) => `Every weekday at ${m[1]}`,
  },
  // "every DAY at TIME" (single day)
  {
    regex: new RegExp(`^every\\s+(${ALL_DAYS.join('|')})\\s+at\\s+(.+)$`, 'i'),
    build: (m) => {
      const day = DAY_MAP[m[1].toLowerCase()]
      if (day === undefined) return null
      const t = parseTime(m[2])
      if (!t) return null
      return `${t.minute} ${t.hour} * * ${day}`
    },
    human: (m) => `Every ${m[1]} at ${m[2]}`,
  },
  // "every DAY and DAY at TIME" or "every DAY, DAY at TIME"
  {
    regex: /^every\s+((?:(?:sun|mon|tue|wed|thu|fri|sat)\w*(?:\s*,\s*|\s+and\s+))*(?:sun|mon|tue|wed|thu|fri|sat)\w*)\s+at\s+(.+)$/i,
    build: (m) => {
      const days = parseDays(m[1])
      if (!days) return null
      const t = parseTime(m[2])
      if (!t) return null
      return `${t.minute} ${t.hour} * * ${days.join(',')}`
    },
    human: (m) => `Every ${m[1]} at ${m[2]}`,
  },
  // "twice a day at TIME and TIME"
  {
    regex: /^twice\s+a\s+day\s+at\s+(.+)\s+and\s+(.+)$/i,
    build: (m) => {
      const t1 = parseTime(m[1])
      const t2 = parseTime(m[2])
      if (!t1 || !t2) return null
      if (t1.minute !== t2.minute) return null // simple case only
      return `${t1.minute} ${t1.hour},${t2.hour} * * *`
    },
    human: (m) => `Twice a day at ${m[1]} and ${m[2]}`,
  },
  // "first of every month at TIME"
  {
    regex: /^(?:(?:the\s+)?first\s+of\s+every\s+month|monthly)\s+at\s+(.+)$/i,
    build: (m) => {
      const t = parseTime(m[1])
      if (!t) return null
      return `${t.minute} ${t.hour} 1 * *`
    },
    human: (m) => `1st of every month at ${m[1]}`,
  },
]

// Validate raw cron expression (5 fields)
const CRON_REGEX = /^([\d*,\-/]+)\s+([\d*,\-/]+)\s+([\d*,\-/]+)\s+([\d*,\-/]+)\s+([\d*,\-/]+)$/

// ─── One-shot ('at') phrase parsing — timezone-aware ────────────────────────

/** Offset of `tz` from UTC at `date`, in ms (DST-correct via Intl). */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  )
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
  return asUTC - date.getTime()
}

/** The absolute instant of a wall-clock (y, m, d, hh:mm) in `tz`. Two-pass
 *  offset resolution handles DST transitions near the target. */
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  let ts = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    ts = Date.UTC(year, month - 1, day, hour, minute) - tzOffsetMs(new Date(ts), tz)
  }
  return new Date(ts)
}

/** Calendar date of `now` as seen in `tz`. */
function dateInTz(now: Date, tz: string): { year: number; month: number; day: number; dow: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  )
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { year: +parts.year, month: +parts.month, day: +parts.day, dow }
}

/** `days` after a calendar date (UTC-noon arithmetic avoids DST day slips). */
function shiftDate(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day, 12))
  d.setUTCDate(d.getUTCDate() + days)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
}

const DEFAULT_ONE_SHOT_HOUR = { hour: 9, minute: 0 }

function humanInstant(instant: Date, tz: string): string {
  const pretty = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(instant)
  return `Once — ${pretty} (${tz})`
}

/** Deterministic one-shot phrases → an absolute instant in `tz`. */
function parseOneShot(trimmed: string, now: Date, tz: string): { instant: Date; human: string } | null {
  const lower = trimmed.toLowerCase()

  // ISO-8601 passthrough ("2026-08-01T15:00:00Z", with or without offset).
  if (/^\d{4}-\d{2}-\d{2}t/i.test(lower)) {
    const ms = Date.parse(trimmed)
    if (!Number.isFinite(ms)) return null
    const instant = new Date(ms)
    return { instant, human: humanInstant(instant, tz) }
  }

  // "in N minutes/hours/days"
  const relative = lower.match(/^in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?)$/)
  if (relative) {
    const n = parseInt(relative[1], 10)
    const unit = relative[2]
    const ms = unit.startsWith('d') ? n * 86_400_000 : unit.startsWith('h') ? n * 3_600_000 : n * 60_000
    const instant = new Date(now.getTime() + ms)
    return { instant, human: humanInstant(instant, tz) }
  }

  // "today at <time>" / "tomorrow at <time>"
  const dayWord = lower.match(/^(today|tomorrow)(?:\s+at)?\s+(.+)$/)
  if (dayWord) {
    const t = parseTime(dayWord[2])
    if (!t) return null
    const base = dateInTz(now, tz)
    const date = dayWord[1] === 'tomorrow' ? shiftDate(base, 1) : base
    const instant = zonedInstant(date.year, date.month, date.day, t.hour, t.minute, tz)
    return { instant, human: humanInstant(instant, tz) }
  }

  // "<weekday> at <time>" — the NEXT occurrence (rolls a week if passed).
  const weekday = lower.match(new RegExp(`^(${ALL_DAYS.join('|')})(?:\\s+at)?\\s+(.+)$`))
  if (weekday) {
    const t = parseTime(weekday[2])
    if (!t) return null
    const targetDow = parseInt(DAY_MAP[weekday[1]], 10)
    const base = dateInTz(now, tz)
    const ahead = (targetDow - base.dow + 7) % 7
    let date = shiftDate(base, ahead)
    let instant = zonedInstant(date.year, date.month, date.day, t.hour, t.minute, tz)
    if (instant.getTime() <= now.getTime()) {
      date = shiftDate(date, 7)
      instant = zonedInstant(date.year, date.month, date.day, t.hour, t.minute, tz)
    }
    return { instant, human: humanInstant(instant, tz) }
  }

  // "(on) <month> <day>[st|nd|rd|th] [at <time>]" — this year, or next if passed.
  const monthDay = lower.match(/^(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+at\s+(.+))?$/)
  if (monthDay && MONTHS[monthDay[1]]) {
    const t = monthDay[3] ? parseTime(monthDay[3]) : DEFAULT_ONE_SHOT_HOUR
    if (!t) return null
    const base = dateInTz(now, tz)
    let instant = zonedInstant(base.year, MONTHS[monthDay[1]], parseInt(monthDay[2], 10), t.hour, t.minute, tz)
    if (instant.getTime() <= now.getTime()) {
      instant = zonedInstant(base.year + 1, MONTHS[monthDay[1]], parseInt(monthDay[2], 10), t.hour, t.minute, tz)
    }
    return { instant, human: humanInstant(instant, tz) }
  }

  return null
}

export interface ParseScheduleOptions {
  /** Reference clock for relative one-shot phrases (tests use a fake now). */
  now?: Date
  /** IANA tz the wall-clock phrases are anchored to. Default: system tz. */
  tz?: string
}

/** Try deterministic parse, return null if no match. */
export function parseSchedule(input: string, opts: ParseScheduleOptions = {}): ParseResult | null {
  const trimmed = input.trim()

  // Check if it's already a raw cron expression
  if (CRON_REGEX.test(trimmed)) {
    return {
      kind: 'cron',
      expr: trimmed,
      human: cronToHuman(trimmed),
      confidence: 'high',
      source: 'raw',
      nextRuns: [],
    }
  }

  // Recurring patterns take precedence — "every …" phrases must never be
  // eaten by the one-shot weekday/month matchers.
  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern.regex)
    if (match) {
      const cron = pattern.build(match)
      if (cron) {
        return {
          kind: 'cron',
          expr: cron,
          human: pattern.human(match),
          confidence: 'high',
          source: 'deterministic',
          nextRuns: [],
        }
      }
    }
  }

  // One-shot phrases → a single absolute instant.
  const now = opts.now ?? new Date()
  const tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const oneShot = parseOneShot(trimmed, now, tz)
  if (oneShot) {
    const iso = oneShot.instant.toISOString()
    return {
      kind: 'at',
      expr: iso,
      human: oneShot.human,
      confidence: 'high',
      source: /^\d{4}-\d{2}-\d{2}t/i.test(trimmed.toLowerCase()) ? 'raw' : 'deterministic',
      nextRuns: [iso],
    }
  }

  return null // no deterministic match (no LLM fallback exists — callers error)
}

/** Simple cron → human-readable string for common patterns. */
export function cronToHuman(cron: string): string {
  const parts = cron.split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, dom, mon, dow] = parts

  // Every minute
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every minute'
  }

  // Every N minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes`
  }

  // Every hour
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Every hour'
  }

  // Every N hours
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`
  }

  // Daily at TIME
  if (dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${formatTime(hour, min)}`
  }

  // Weekdays
  if (dom === '*' && mon === '*' && dow === '1-5') {
    return `Weekdays at ${formatTime(hour, min)}`
  }

  // Specific days
  if (dom === '*' && mon === '*' && dow !== '*') {
    const dayNames = dow.split(',').map(d => {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const num = parseInt(d, 10)
      return names[num] ?? d
    })
    return `${dayNames.join(', ')} at ${formatTime(hour, min)}`
  }

  // Monthly
  if (dom !== '*' && mon === '*' && dow === '*') {
    return `Day ${dom} of month at ${formatTime(hour, min)}`
  }

  return cron
}

function formatTime(hour: string, minute: string): string {
  // Handle comma-separated hours (e.g., "9,17")
  if (hour.includes(',')) {
    const hours = hour.split(',')
    return hours.map(h => formatTime(h, minute)).join(' and ')
  }
  const h = parseInt(hour, 10)
  const m = parseInt(minute, 10)
  if (isNaN(h) || isNaN(m)) return `${hour}:${minute}`
  const period = h >= 12 ? 'pm' : 'am'
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${displayHour}${period}` : `${displayHour}:${m.toString().padStart(2, '0')}${period}`
}
