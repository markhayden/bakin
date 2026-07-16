/**
 * Cron expression evaluation — the ONLY place `cron-parser` is imported.
 *
 * Keeping the library behind this thin seam means the Bakin scheduler depends
 * on three small, timezone-aware primitives (validity, next-fire, occurrences-
 * in-a-window) rather than the parser's full surface, and the library stays
 * trivially swappable. All evaluation is done in the job's IANA timezone so
 * wall-clock schedules survive DST transitions.
 */
import { CronExpressionParser } from 'cron-parser'

/** Fallback when a job has no explicit timezone. Matches getSystemTimezone(). */
function tzOrDefault(tz: string | undefined): string {
  return tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** True when `expr` is a cron expression cron-parser can evaluate. */
export function isValidExpr(expr: string): boolean {
  if (!expr || !expr.trim()) return false
  try {
    CronExpressionParser.parse(expr, { tz: tzOrDefault(undefined) })
    return true
  } catch {
    return false
  }
}

/**
 * The next occurrence strictly after `after`, evaluated in `tz`.
 * Returns null for an invalid expression. `after` sitting exactly on an
 * occurrence yields the following one (cron-parser treats currentDate as
 * exclusive), which is what keeps per-occurrence dedup honest.
 */
export function nextRun(expr: string, tz: string | undefined, after: Date): Date | null {
  try {
    const it = CronExpressionParser.parse(expr, { tz: tzOrDefault(tz), currentDate: after })
    return it.next().toDate()
  } catch {
    return null
  }
}

/**
 * The most recent occurrence strictly before `before`, evaluated in `tz`.
 * Returns null for an invalid expression. Used by startup catch-up to find the
 * last occurrence that should already have fired.
 */
export function prevRun(expr: string, tz: string | undefined, before: Date): Date | null {
  try {
    const it = CronExpressionParser.parse(expr, { tz: tzOrDefault(tz), currentDate: before })
    return it.prev().toDate()
  } catch {
    return null
  }
}

/**
 * All occurrences in the window `(from, to]`, ascending, evaluated in `tz`.
 * Strictly after `from`, up to and including `to`. Returns an empty array for
 * an invalid expression or an empty window.
 */
export function occurrencesBetween(expr: string, tz: string | undefined, from: Date, to: Date): Date[] {
  try {
    const it = CronExpressionParser.parse(expr, {
      tz: tzOrDefault(tz),
      currentDate: from,
      endDate: to,
    })
    const out: Date[] = []
    while (it.hasNext()) out.push(it.next().toDate())
    return out
  } catch {
    return []
  }
}

// ─── Schedule-aware dispatch (kind 'cron' | 'at') ───────────────────────────
// The scheduler evaluates ScheduleDefs, not raw expressions: 'cron' delegates
// to the expression engine above; 'at' is a single absolute ISO-8601 instant
// (tz-independent — the tz parameter only shapes cron wall-clock evaluation).

import type { ScheduleDef } from '../types'

/** The instant an 'at' expr names, or null when unparseable. */
function atInstant(expr: string): Date | null {
  const ms = Date.parse(expr)
  return Number.isFinite(ms) ? new Date(ms) : null
}

export function isValidScheduleDef(def: ScheduleDef): boolean {
  return def.kind === 'at' ? atInstant(def.expr) !== null : isValidExpr(def.expr)
}

/** Next occurrence strictly after `after` — for 'at', the instant while it is
 *  still in the future, then null forever (one-shots never repeat). */
export function scheduleNextRun(def: ScheduleDef, tz: string | undefined, after: Date): Date | null {
  if (def.kind !== 'at') return nextRun(def.expr, tz, after)
  const instant = atInstant(def.expr)
  return instant && instant.getTime() > after.getTime() ? instant : null
}

/** Most recent occurrence at or before `before` — for 'at', the instant once
 *  it has passed (what startup catch-up looks for), else null. */
export function schedulePrevRun(def: ScheduleDef, tz: string | undefined, before: Date): Date | null {
  if (def.kind !== 'at') return prevRun(def.expr, tz, before)
  const instant = atInstant(def.expr)
  return instant && instant.getTime() <= before.getTime() ? instant : null
}

/** Occurrences in `(from, to]` — for 'at', at most the single instant. */
export function scheduleOccurrencesBetween(def: ScheduleDef, tz: string | undefined, from: Date, to: Date): Date[] {
  if (def.kind !== 'at') return occurrencesBetween(def.expr, tz, from, to)
  const instant = atInstant(def.expr)
  return instant && instant.getTime() > from.getTime() && instant.getTime() <= to.getTime() ? [instant] : []
}
