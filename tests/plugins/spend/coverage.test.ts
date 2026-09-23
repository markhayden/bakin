/**
 * Coverage summary + limit suggestion (spec D27/D32, plan T2.9c): the
 * suggestion counts spend on OBSERVED days only (scan_days receipts),
 * needs ≥ 14 covered days in the last 30 with no rule-relevant evidence
 * gaps and non-zero spend, and equals 1.5 × the covered daily rate × 30
 * rounded to a nice number. Both totals come from the ONE spend engine's
 * day-set variant — no arithmetic of its own beyond the rate.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-spend-coverage')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

// The engine is mocked at its boundary: coverage composes coveredDaysSince +
// assembleSpendForDays and derives the summary; the engine's own honesty
// (overlap, gaps) is pinned in tests/core/budget-spend.test.ts.
let covered: string[] = []
const spendByDay = new Map<string, { usd: number; subscriptionTokens?: number; gap?: boolean }>()
mock.module('../../../packages/core/src/usage-history/store', () => ({
  coveredDaysSince: (days: number, now: number) => covered.filter((d) => d >= dayKey(now - (days - 1) * 86_400_000)),
  localDayKeyDaysAgo: (now: number, n: number) => dayKey(now - n * 86_400_000),
  toLocalDayKey: dayKey,
}))
mock.module('../../../src/core/budget-spend', () => ({
  assembleSpendForDays: async (days: string[], now: number) => {
    let usd = 0
    let subscriptionTokens = 0
    const gaps: unknown[] = []
    for (const day of days) {
      const cell = spendByDay.get(day)
      if (!cell) continue
      usd += cell.usd
      subscriptionTokens += cell.subscriptionTokens ?? 0
      if (cell.gap) gaps.push({ unit: 'usd_micros', source: 'attributed_run', lane: 'metered', agent: 'pixel', provider: 'google', model: null, reasons: ['value_missing'], unknownCount: 1, earliestDay: day })
    }
    return {
      computedAt: now,
      days: [...days].sort(),
      observedUsageEvidence: { status: 'available' },
      spendEvidence: { status: gaps.length ? 'incomplete' : 'complete', gaps },
      window: { startMs: 0, global: { meteredUsdMicros: usd, meteredTokens: 0, subscriptionTokens, unpricedMeteredTokens: 0, unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 } }, byAgent: {}, byProvider: {}, byModel: {}, byWorkClass: {} },
    }
  },
}))

function dayKey(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

import { coverageSummary, roundToNice, suggestMonthlyLimit } from '../../../plugins/spend/lib/coverage'

const NOW = new Date(2026, 8, 22, 12, 0, 0).getTime()
const daysAgo = (n: number) => dayKey(NOW - n * 86_400_000)

afterEach(() => {
  covered = []
  spendByDay.clear()
})

describe('roundToNice', () => {
  it('rounds to a human number at each magnitude', () => {
    expect(roundToNice(0)).toBe(0)
    expect(roundToNice(3.2)).toBe(5)
    expect(roundToNice(7)).toBe(10)
    expect(roundToNice(23)).toBe(25)
    expect(roundToNice(47)).toBe(50)
    expect(roundToNice(450)).toBe(450)
    expect(roundToNice(463)).toBe(500)
    expect(roundToNice(1_240)).toBe(1_500)
  })
})

describe('coverageSummary', () => {
  it('splits the last 30 days into covered and uncovered spend using the day-set engine', async () => {
    covered = [daysAgo(0), daysAgo(1), daysAgo(2)]
    spendByDay.set(daysAgo(1), { usd: 10_000_000 })
    spendByDay.set(daysAgo(5), { usd: 7_000_000 }) // backfilled on an unobserved day
    const s = await coverageSummary(30, NOW)
    expect(s.coveredDays).toEqual([daysAgo(2), daysAgo(1), daysAgo(0)])
    expect(s.uncoveredDays).toHaveLength(27)
    expect(s.covered.window.global.meteredUsdMicros).toBe(10_000_000)
    expect(s.uncovered.window.global.meteredUsdMicros).toBe(7_000_000)
  })
})

describe('suggestMonthlyLimit', () => {
  function coverDays(n: number, usdPerDay: number) {
    for (let i = 0; i < n; i++) {
      covered.push(daysAgo(i))
      spendByDay.set(daysAgo(i), { usd: usdPerDay })
    }
  }

  it('14 covered days at $10/day ⇒ ~$450, basis stated, backfill on unobserved days shown separately', async () => {
    coverDays(14, 10_000_000)
    spendByDay.set(daysAgo(20), { usd: 99_000_000 }) // unobserved — excluded from the rate
    const s = await suggestMonthlyLimit(await coverageSummary(30, NOW))
    expect(s.status).toBe('ready')
    if (s.status !== 'ready') return
    expect(s.monthlyUsd).toBe(450)
    expect(s.basis).toEqual({ coveredDays: 14, coveredUsdMicros: 140_000_000, dailyRateUsdMicros: 10_000_000 })
    expect(s.unobservedUsdMicros).toBe(99_000_000)
  })

  it('fewer than 14 covered days ⇒ no prefill, with the days still needed', async () => {
    coverDays(9, 10_000_000)
    const s = await suggestMonthlyLimit(await coverageSummary(30, NOW))
    expect(s).toEqual({ status: 'insufficient_history', coveredDays: 9, daysNeeded: 5 })
  })

  it('a zero-use covered day counts as observed; all-zero covered spend is a subscription-only story, not a $0 suggestion', async () => {
    coverDays(20, 0)
    spendByDay.set(daysAgo(1), { usd: 0, subscriptionTokens: 50_000 })
    const s = await suggestMonthlyLimit(await coverageSummary(30, NOW))
    expect(s).toMatchObject({ status: 'no_metered_spend', coveredDays: 20, subscriptionTokens: 50_000 })
  })

  it('a rule-relevant evidence gap on a covered day withholds the suggestion (never suggest from unverifiable numbers)', async () => {
    coverDays(14, 10_000_000)
    spendByDay.set(daysAgo(3), { usd: 10_000_000, gap: true })
    const s = await suggestMonthlyLimit(await coverageSummary(30, NOW))
    expect(s).toMatchObject({ status: 'evidence_incomplete', coveredDays: 14 })
  })
})
