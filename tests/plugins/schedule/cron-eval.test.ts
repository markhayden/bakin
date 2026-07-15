import { describe, it, expect } from 'bun:test'
import { isValidExpr, nextRun, occurrencesBetween } from '@bakin/schedule/lib/cron-eval'

const DENVER = 'America/Denver'

/** Local hour:minute of a date in a given IANA tz (for DST-safe assertions). */
function localHM(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

describe('schedule/cron-eval', () => {
  describe('isValidExpr', () => {
    it('accepts a valid 5-field cron', () => {
      expect(isValidExpr('0 9 * * *')).toBe(true)
    })
    it('rejects garbage', () => {
      expect(isValidExpr('not a cron')).toBe(false)
    })
    it('rejects empty', () => {
      expect(isValidExpr('')).toBe(false)
    })
  })

  describe('nextRun', () => {
    it('returns the next daily occurrence in the job tz', () => {
      const after = new Date('2026-06-07T00:00:00Z')
      const n = nextRun('0 9 * * *', DENVER, after)
      expect(n).not.toBeNull()
      // 9am MDT (UTC-6) on 2026-06-07
      expect(n!.toISOString()).toBe('2026-06-07T15:00:00.000Z')
    })

    it('is strictly after `after` when `after` sits exactly on an occurrence', () => {
      const onOccurrence = new Date('2026-06-07T15:00:00Z') // exactly 9am MDT
      const n = nextRun('0 9 * * *', DENVER, onOccurrence)
      expect(n!.toISOString()).toBe('2026-06-08T15:00:00.000Z')
    })

    it('returns null for an invalid expression', () => {
      expect(nextRun('not a cron', DENVER, new Date('2026-06-07T00:00:00Z'))).toBeNull()
    })

    it('defaults to a sane tz when none provided', () => {
      const n = nextRun('0 9 * * *', undefined, new Date('2026-06-07T00:00:00Z'))
      expect(n).not.toBeNull()
    })
  })

  describe('occurrencesBetween', () => {
    it('returns occurrences strictly after `from` through `to`, ascending', () => {
      const from = new Date('2026-06-07T00:00:00Z')
      const to = new Date('2026-06-09T16:00:00Z')
      const occ = occurrencesBetween('0 9 * * *', DENVER, from, to)
      expect(occ.map(d => d.toISOString())).toEqual([
        '2026-06-07T15:00:00.000Z',
        '2026-06-08T15:00:00.000Z',
        '2026-06-09T15:00:00.000Z',
      ])
    })

    it('returns empty when the window contains no occurrence', () => {
      const from = new Date('2026-06-07T16:00:00Z') // just past 9am MDT
      const to = new Date('2026-06-07T23:00:00Z')
      expect(occurrencesBetween('0 9 * * *', DENVER, from, to)).toEqual([])
    })

    it('returns empty for an invalid expression', () => {
      const from = new Date('2026-06-07T00:00:00Z')
      const to = new Date('2026-06-08T00:00:00Z')
      expect(occurrencesBetween('not a cron', DENVER, from, to)).toEqual([])
    })

    it('keeps occurrences at local wall-clock time across a DST spring-forward', () => {
      // US DST 2026: clocks spring forward on Sun 2026-03-08. A daily 9am job
      // must remain local 9am on both sides of the change (UTC shifts -7 → -6).
      const from = new Date('2026-03-06T00:00:00Z')
      const to = new Date('2026-03-10T17:00:00Z')
      const occ = occurrencesBetween('0 9 * * *', DENVER, from, to)
      expect(occ.length).toBe(4) // Mar 7, 8, 9, 10
      for (const d of occ) {
        expect(localHM(d, DENVER)).toBe('09:00')
      }
      // And the UTC offset really did shift across the boundary.
      const mar7 = occ.find(d => d.toISOString().startsWith('2026-03-07'))!
      const mar9 = occ.find(d => d.toISOString().startsWith('2026-03-09'))!
      expect(mar7.toISOString()).toBe('2026-03-07T16:00:00.000Z') // MST, UTC-7
      expect(mar9.toISOString()).toBe('2026-03-09T15:00:00.000Z') // MDT, UTC-6
    })
  })
})

// ─── Schedule-aware dispatch (kind 'cron' | 'at') ───────────────────────────

import { scheduleNextRun, schedulePrevRun, scheduleOccurrencesBetween, isValidScheduleDef } from '@bakin/schedule/lib/cron-eval'

describe('schedule/cron-eval schedule-aware wrappers', () => {
  const AT = '2026-06-07T15:00:00.000Z'
  const atDef = { kind: 'at' as const, expr: AT }
  const cronDef = { kind: 'cron' as const, expr: '0 9 * * *' }

  describe("kind 'at'", () => {
    it('occurrencesBetween yields the single instant inside (from, to]', () => {
      const from = new Date('2026-06-07T14:59:00Z')
      const to = new Date('2026-06-07T15:00:30Z')
      expect(scheduleOccurrencesBetween(atDef, DENVER, from, to).map(d => d.toISOString())).toEqual([AT])
    })
    it('occurrencesBetween is empty outside the window and never repeats', () => {
      expect(scheduleOccurrencesBetween(atDef, DENVER, new Date('2026-06-07T15:00:01Z'), new Date('2026-06-07T16:00:00Z'))).toEqual([])
      expect(scheduleOccurrencesBetween(atDef, DENVER, new Date('2026-06-06T00:00:00Z'), new Date('2026-06-07T14:00:00Z'))).toEqual([])
    })
    it('boundary: strictly after from, inclusive of to', () => {
      expect(scheduleOccurrencesBetween(atDef, DENVER, new Date(AT), new Date('2026-06-07T16:00:00Z'))).toEqual([])
      expect(scheduleOccurrencesBetween(atDef, DENVER, new Date('2026-06-07T14:00:00Z'), new Date(AT)).map(d => d.toISOString())).toEqual([AT])
    })
    it('nextRun is the instant when still future, null once passed', () => {
      expect(scheduleNextRun(atDef, DENVER, new Date('2026-06-07T14:00:00Z'))?.toISOString()).toBe(AT)
      expect(scheduleNextRun(atDef, DENVER, new Date(AT))).toBeNull()
    })
    it('prevRun is the instant once passed, null while future', () => {
      expect(schedulePrevRun(atDef, DENVER, new Date('2026-06-08T00:00:00Z'))?.toISOString()).toBe(AT)
      expect(schedulePrevRun(atDef, DENVER, new Date('2026-06-07T14:00:00Z'))).toBeNull()
    })
    it('invalid instants are invalid and yield nothing', () => {
      const bad = { kind: 'at' as const, expr: 'tomorrow-ish' }
      expect(isValidScheduleDef(bad)).toBe(false)
      expect(scheduleOccurrencesBetween(bad, DENVER, new Date(0), new Date())).toEqual([])
      expect(scheduleNextRun(bad, DENVER, new Date(0))).toBeNull()
      expect(schedulePrevRun(bad, DENVER, new Date())).toBeNull()
    })
    it('valid instants validate', () => {
      expect(isValidScheduleDef(atDef)).toBe(true)
    })
  })

  describe("kind 'cron' delegates to the expression engine", () => {
    it('occurrences + next/prev match the raw-expr functions', () => {
      const from = new Date('2026-06-07T00:00:00Z')
      const to = new Date('2026-06-08T00:00:00Z')
      expect(scheduleOccurrencesBetween(cronDef, DENVER, from, to).map(d => d.toISOString()))
        .toEqual(occurrencesBetween(cronDef.expr, DENVER, from, to).map(d => d.toISOString()))
      expect(scheduleNextRun(cronDef, DENVER, from)?.toISOString()).toBe(nextRun(cronDef.expr, DENVER, from)?.toISOString())
      expect(isValidScheduleDef(cronDef)).toBe(true)
      expect(isValidScheduleDef({ kind: 'cron', expr: 'garbage' })).toBe(false)
    })
  })
})
