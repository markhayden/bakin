import { describe, it, expect } from 'bun:test'
import { parseSchedule, cronToHuman } from '@bakin/schedule/lib/cron-parser'

describe('schedule/cron-parser', () => {
  describe('parseSchedule', () => {
    // --- Raw cron passthrough ---
    it('passes through valid 5-field cron expression', () => {
      const result = parseSchedule('0 9 * * *')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 * * *')
      expect(result!.source).toBe('raw')
      expect(result!.confidence).toBe('high')
    })

    it('passes through complex cron expressions', () => {
      const result = parseSchedule('*/15 9-17 * * 1-5')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('*/15 9-17 * * 1-5')
      expect(result!.source).toBe('raw')
    })

    // --- Bare time → daily ---
    it('parses bare "10am" as daily at 10am', () => {
      const result = parseSchedule('10am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 10 * * *')
    })

    it('parses "9:30pm" as daily', () => {
      const result = parseSchedule('9:30pm')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('30 21 * * *')
    })

    it('parses "at 10am" as daily', () => {
      const result = parseSchedule('at 10am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 10 * * *')
    })

    it('parses "10am MST" as daily, stripping tz', () => {
      const result = parseSchedule('10am MST')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 10 * * *')
    })

    // --- "every day at TIME" ---
    it('parses "every day at 9am"', () => {
      const result = parseSchedule('every day at 9am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 * * *')
      expect(result!.source).toBe('deterministic')
    })

    it('parses "every day at 2:30pm"', () => {
      const result = parseSchedule('every day at 2:30pm')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('30 14 * * *')
    })

    it('parses "daily at 8am"', () => {
      const result = parseSchedule('daily at 8am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 8 * * *')
    })

    it('parses "every day at noon"', () => {
      const result = parseSchedule('every day at noon')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 12 * * *')
    })

    it('parses "every day at midnight"', () => {
      const result = parseSchedule('every day at midnight')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 0 * * *')
    })

    // --- Timezone suffixes (stripped — cron is server-local) ---
    it('strips timezone suffix "every day at 9am MST"', () => {
      const result = parseSchedule('every day at 9am MST')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 * * *')
    })

    it('strips timezone suffix "every weekday at 8:30am EST"', () => {
      const result = parseSchedule('every weekday at 8:30am EST')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('30 8 * * 1-5')
    })

    it('strips timezone suffix "every day at 2pm pdt"', () => {
      const result = parseSchedule('every day at 2pm pdt')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 14 * * *')
    })

    // --- "every weekday at TIME" ---
    it('parses "every weekday at 8:30am"', () => {
      const result = parseSchedule('every weekday at 8:30am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('30 8 * * 1-5')
    })

    // --- "every DAY at TIME" ---
    it('parses "every Monday at 10am"', () => {
      const result = parseSchedule('every Monday at 10am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 10 * * 1')
    })

    it('parses "every Sunday at 6pm"', () => {
      const result = parseSchedule('every Sunday at 6pm')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 18 * * 0')
    })

    it('parses "every friday at 5pm"', () => {
      const result = parseSchedule('every friday at 5pm')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 17 * * 5')
    })

    // --- Multiple days ---
    it('parses "every Monday and Thursday at 10am"', () => {
      const result = parseSchedule('every Monday and Thursday at 10am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 10 * * 1,4')
    })

    it('parses "every Monday, Wednesday, Friday at 9am"', () => {
      const result = parseSchedule('every Monday, Wednesday, Friday at 9am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 * * 1,3,5')
    })

    // --- Intervals ---
    it('parses "every 30 minutes"', () => {
      const result = parseSchedule('every 30 minutes')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('*/30 * * * *')
    })

    it('parses "every 2 hours"', () => {
      const result = parseSchedule('every 2 hours')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 */2 * * *')
    })

    it('parses "every hour"', () => {
      const result = parseSchedule('every hour')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 * * * *')
    })

    it('parses "every minute"', () => {
      const result = parseSchedule('every minute')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('* * * * *')
    })

    // --- Monthly ---
    it('parses "first of every month at noon"', () => {
      const result = parseSchedule('first of every month at noon')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 12 1 * *')
    })

    it('parses "monthly at 9am"', () => {
      const result = parseSchedule('monthly at 9am')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 1 * *')
    })

    // --- Twice a day ---
    it('parses "twice a day at 9am and 5pm"', () => {
      const result = parseSchedule('twice a day at 9am and 5pm')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9,17 * * *')
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
      expect(result!.cron).toBe('0 15 * * 1')
    })

    // --- Whitespace tolerance ---
    it('trims whitespace', () => {
      const result = parseSchedule('  every day at 9am  ')
      expect(result).not.toBeNull()
      expect(result!.cron).toBe('0 9 * * *')
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
