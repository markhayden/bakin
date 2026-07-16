import { describe, it, expect } from 'bun:test'
import { parseSchedule, cronToHuman } from '@bakin/schedule/lib/cron-parser'

describe('schedule/cron-parser', () => {
  describe('parseSchedule', () => {
    // --- Raw cron passthrough ---
    it('passes through valid 5-field cron expression', () => {
      const result = parseSchedule('0 9 * * *')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 * * *')
      expect(result!.source).toBe('raw')
      expect(result!.confidence).toBe('high')
    })

    it('passes through complex cron expressions', () => {
      const result = parseSchedule('*/15 9-17 * * 1-5')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('*/15 9-17 * * 1-5')
      expect(result!.source).toBe('raw')
    })

    // --- Bare time → daily ---
    it('parses bare "10am" as daily at 10am', () => {
      const result = parseSchedule('10am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 10 * * *')
    })

    it('parses "9:30pm" as daily', () => {
      const result = parseSchedule('9:30pm')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('30 21 * * *')
    })

    it('parses "at 10am" as daily', () => {
      const result = parseSchedule('at 10am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 10 * * *')
    })

    it('parses "10am MST" as daily, stripping tz', () => {
      const result = parseSchedule('10am MST')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 10 * * *')
    })

    // --- "every day at TIME" ---
    it('parses "every day at 9am"', () => {
      const result = parseSchedule('every day at 9am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 * * *')
      expect(result!.source).toBe('deterministic')
    })

    it('parses "every day at 2:30pm"', () => {
      const result = parseSchedule('every day at 2:30pm')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('30 14 * * *')
    })

    it('parses "daily at 8am"', () => {
      const result = parseSchedule('daily at 8am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 8 * * *')
    })

    it('parses "every day at noon"', () => {
      const result = parseSchedule('every day at noon')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 12 * * *')
    })

    it('parses "every day at midnight"', () => {
      const result = parseSchedule('every day at midnight')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 0 * * *')
    })

    // --- Timezone suffixes (stripped — cron is server-local) ---
    it('strips timezone suffix "every day at 9am MST"', () => {
      const result = parseSchedule('every day at 9am MST')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 * * *')
    })

    it('strips timezone suffix "every weekday at 8:30am EST"', () => {
      const result = parseSchedule('every weekday at 8:30am EST')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('30 8 * * 1-5')
    })

    it('strips timezone suffix "every day at 2pm pdt"', () => {
      const result = parseSchedule('every day at 2pm pdt')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 14 * * *')
    })

    // --- "every weekday at TIME" ---
    it('parses "every weekday at 8:30am"', () => {
      const result = parseSchedule('every weekday at 8:30am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('30 8 * * 1-5')
    })

    // --- "every DAY at TIME" ---
    it('parses "every Monday at 10am"', () => {
      const result = parseSchedule('every Monday at 10am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 10 * * 1')
    })

    it('parses "every Sunday at 6pm"', () => {
      const result = parseSchedule('every Sunday at 6pm')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 18 * * 0')
    })

    it('parses "every friday at 5pm"', () => {
      const result = parseSchedule('every friday at 5pm')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 17 * * 5')
    })

    // --- Multiple days ---
    it('parses "every Monday and Thursday at 10am"', () => {
      const result = parseSchedule('every Monday and Thursday at 10am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 10 * * 1,4')
    })

    it('parses "every Monday, Wednesday, Friday at 9am"', () => {
      const result = parseSchedule('every Monday, Wednesday, Friday at 9am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 * * 1,3,5')
    })

    // --- Intervals ---
    it('parses "every 30 minutes"', () => {
      const result = parseSchedule('every 30 minutes')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('*/30 * * * *')
    })

    it('parses "every 2 hours"', () => {
      const result = parseSchedule('every 2 hours')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 */2 * * *')
    })

    it('parses "every hour"', () => {
      const result = parseSchedule('every hour')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 * * * *')
    })

    it('parses "every minute"', () => {
      const result = parseSchedule('every minute')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('* * * * *')
    })

    // --- Monthly ---
    it('parses "first of every month at noon"', () => {
      const result = parseSchedule('first of every month at noon')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 12 1 * *')
    })

    it('parses "monthly at 9am"', () => {
      const result = parseSchedule('monthly at 9am')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 1 * *')
    })

    // --- Twice a day ---
    it('parses "twice a day at 9am and 5pm"', () => {
      const result = parseSchedule('twice a day at 9am and 5pm')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9,17 * * *')
    })

    // --- Invalid / no match ---
    it('returns null for unparseable input', () => {
      expect(parseSchedule('whenever the mood strikes')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseSchedule('')).toBeNull()
    })

    // --- Case insensitivity ---
    it('handles mixed case', () => {
      const result = parseSchedule('Every MONDAY at 3PM')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 15 * * 1')
    })

    // --- Whitespace tolerance ---
    it('trims whitespace', () => {
      const result = parseSchedule('  every day at 9am  ')
      expect(result).not.toBeNull()
      expect(result!.expr).toBe('0 9 * * *')
    })
  })

  describe('cronToHuman', () => {
    it('describes "0 9 * * *" as daily', () => {
      expect(cronToHuman('0 9 * * *')).toBe('Daily at 9am')
    })

    it('describes "30 14 * * 1-5" as weekdays', () => {
      expect(cronToHuman('30 14 * * 1-5')).toBe('Weekdays at 2:30pm')
    })

    it('describes "*/15 * * * *" as interval', () => {
      expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes')
    })

    it('describes "0 * * * *" as every hour', () => {
      expect(cronToHuman('0 * * * *')).toBe('Every hour')
    })

    it('describes "0 */3 * * *" as every N hours', () => {
      expect(cronToHuman('0 */3 * * *')).toBe('Every 3 hours')
    })

    it('describes "0 10 * * 1,4" with day names', () => {
      expect(cronToHuman('0 10 * * 1,4')).toBe('Mon, Thu at 10am')
    })

    it('describes "0 12 1 * *" as monthly', () => {
      expect(cronToHuman('0 12 1 * *')).toBe('Day 1 of month at 12pm')
    })

    it('returns raw cron for unparseable expressions', () => {
      expect(cronToHuman('invalid')).toBe('invalid')
    })
  })
})

// ─── One-shot phrases → kind 'at' ───────────────────────────────────────────

describe('parseSchedule one-shot phrases', () => {
  const DENVER = 'America/Denver'
  // Sunday 2026-06-07, 12:00 noon in Denver (MDT, UTC-6)
  const NOW = new Date('2026-06-07T18:00:00.000Z')
  const opts = { now: NOW, tz: DENVER }

  it("'tomorrow at 9am' → the next day's 9am in the job tz", () => {
    const result = parseSchedule('tomorrow at 9am', opts)
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('at')
    expect(result!.expr).toBe('2026-06-08T15:00:00.000Z')
    expect(result!.source).toBe('deterministic')
    expect(result!.nextRuns).toEqual(['2026-06-08T15:00:00.000Z'])
  })

  it("'today at 5pm' → today's 5pm in the job tz", () => {
    const result = parseSchedule('today at 5pm', opts)
    expect(result!.kind).toBe('at')
    expect(result!.expr).toBe('2026-06-07T23:00:00.000Z')
  })

  it("'in 2 hours' / 'in 30 minutes' / 'in 3 days' → now + delta", () => {
    expect(parseSchedule('in 2 hours', opts)!.expr).toBe('2026-06-07T20:00:00.000Z')
    expect(parseSchedule('in 30 minutes', opts)!.expr).toBe('2026-06-07T18:30:00.000Z')
    expect(parseSchedule('in 3 days', opts)!.expr).toBe('2026-06-10T18:00:00.000Z')
  })

  it("'monday at 9am' → the NEXT monday 9am in the job tz", () => {
    const result = parseSchedule('monday at 9am', opts)
    expect(result!.kind).toBe('at')
    expect(result!.expr).toBe('2026-06-08T15:00:00.000Z')
  })

  it('a weekday whose time already passed today rolls to next week', () => {
    // NOW is Sunday noon; 'sunday at 9am' already passed → next Sunday.
    const result = parseSchedule('sunday at 9am', opts)
    expect(result!.expr).toBe('2026-06-14T15:00:00.000Z')
  })

  it("'july 20 at 3pm' → that date this year (future) in the job tz", () => {
    const result = parseSchedule('july 20 at 3pm', opts)
    expect(result!.kind).toBe('at')
    expect(result!.expr).toBe('2026-07-20T21:00:00.000Z')
  })

  it('a month/day already passed this year rolls to next year', () => {
    const result = parseSchedule('january 5 at 9am', opts)
    expect(result!.expr).toBe('2027-01-05T16:00:00.000Z') // MST, UTC-7
  })

  it("'july 20' defaults to 9am", () => {
    expect(parseSchedule('july 20', opts)!.expr).toBe('2026-07-20T15:00:00.000Z')
  })

  it('ISO-8601 passthrough → kind at, normalized instant', () => {
    const result = parseSchedule('2026-08-01T15:00:00Z', opts)
    expect(result!.kind).toBe('at')
    expect(result!.expr).toBe('2026-08-01T15:00:00.000Z')
    expect(result!.source).toBe('raw')
  })

  it('a past ISO instant still parses (rejection is the creation path’s job)', () => {
    const result = parseSchedule('2020-01-01T00:00:00Z', opts)
    expect(result!.kind).toBe('at')
  })

  it('recurring phrases still parse as cron', () => {
    const result = parseSchedule('every day at 9am', opts)
    expect(result!.kind).toBe('cron')
    expect(result!.expr).toBe('0 9 * * *')
  })

  it('DST boundary: a one-shot across the spring-forward gap lands on the wall clock', () => {
    // 2027-03-14 is the US spring-forward date; 9am MST→MDT (UTC-6 after).
    const result = parseSchedule('march 14 at 9am', { now: new Date('2027-03-01T00:00:00Z'), tz: DENVER })
    expect(result!.expr).toBe('2027-03-14T15:00:00.000Z')
  })
})
