/**
 * Coverage-aware limit suggestion (spec D27/D32).
 *
 * "Set a cap based on what you spend" is only honest for days Bakin
 * actually watched: a day counts as covered when a usage sweep completed
 * with full roster coverage (scan_days receipts). Covered and uncovered
 * totals both come from the ONE spend engine's day-set variant — this
 * module adds no spend arithmetic beyond the daily rate — so the number in
 * the dialog agrees with the Overview by construction.
 */
import { coveredDaysSince, localDayKeyDaysAgo } from '@bakin/core/usage-history/store'
import { assembleSpendForDays, type DaySetSpend } from '../../../src/core/budget-spend'

/** Days the suggestion looks back over. */
export const COVERAGE_LOOKBACK_DAYS = 30
/** Covered days required before a number is offered (D27). */
export const MIN_COVERED_DAYS = 14
/** Headroom over the observed rate: a limit that trips at "normal" is noise. */
export const SUGGESTION_HEADROOM = 1.5

export interface CoverageSummary {
  lookbackDays: number
  computedAt: number
  /** Ascending local day keys that received a complete sweep. */
  coveredDays: string[]
  /** Ascending local day keys in the lookback with no receipt. */
  uncoveredDays: string[]
  covered: DaySetSpend
  uncovered: DaySetSpend
}

export async function coverageSummary(lookbackDays: number = COVERAGE_LOOKBACK_DAYS, now: number = Date.now()): Promise<CoverageSummary> {
  const coveredDays = [...coveredDaysSince(lookbackDays, now)].sort()
  const coveredSet = new Set(coveredDays)
  const uncoveredDays: string[] = []
  for (let i = lookbackDays - 1; i >= 0; i--) {
    const day = localDayKeyDaysAgo(now, i)
    if (!coveredSet.has(day)) uncoveredDays.push(day)
  }
  const [covered, uncovered] = await Promise.all([
    assembleSpendForDays(coveredDays, now),
    assembleSpendForDays(uncoveredDays, now),
  ])
  return { lookbackDays, computedAt: now, coveredDays, uncoveredDays, covered, uncovered }
}

/**
 * Human-shaped dollar amount at or above `usd`: multiples of $5 under $100,
 * $50 under $1,000, $500 above — 3.2→5, 23→25, 450→450, 463→500, 1240→1500.
 */
export function roundToNice(usd: number): number {
  if (usd <= 0) return 0
  const step = usd < 100 ? 5 : usd < 1_000 ? 50 : 500
  return Math.ceil(usd / step) * step
}

export type LimitSuggestion =
  | {
      status: 'ready'
      monthlyUsd: number
      basis: { coveredDays: number; coveredUsdMicros: number; dailyRateUsdMicros: number }
      /** Spend recorded on days Bakin was not watching — shown, never in the rate. */
      unobservedUsdMicros: number
    }
  | { status: 'insufficient_history'; coveredDays: number; daysNeeded: number }
  | { status: 'evidence_incomplete'; coveredDays: number }
  | { status: 'no_metered_spend'; coveredDays: number; subscriptionTokens: number }

function meteredTotal(spend: DaySetSpend): number {
  return spend.window.global.meteredUsdMicros + spend.window.global.unattributed.meteredUsdMicros
}

/**
 * The prefill for the limit dialog. Order of honesty: not enough observed
 * days → an unverifiable number → nothing metered to base it on → the
 * suggestion with its basis.
 */
export async function suggestMonthlyLimit(summary: CoverageSummary): Promise<LimitSuggestion> {
  const coveredDays = summary.coveredDays.length
  if (coveredDays < MIN_COVERED_DAYS) {
    return { status: 'insufficient_history', coveredDays, daysNeeded: MIN_COVERED_DAYS - coveredDays }
  }
  if (summary.covered.spendEvidence.gaps.length > 0 || summary.covered.observedUsageEvidence.status !== 'available') {
    return { status: 'evidence_incomplete', coveredDays }
  }
  const coveredUsdMicros = meteredTotal(summary.covered)
  if (coveredUsdMicros <= 0) {
    const subscriptionTokens = summary.covered.window.global.subscriptionTokens + summary.covered.window.global.unattributed.subscriptionTokens
    return { status: 'no_metered_spend', coveredDays, subscriptionTokens }
  }
  const dailyRateUsdMicros = Math.round(coveredUsdMicros / coveredDays)
  const monthlyUsd = roundToNice((SUGGESTION_HEADROOM * dailyRateUsdMicros * 30) / 1_000_000)
  return {
    status: 'ready',
    monthlyUsd,
    basis: { coveredDays, coveredUsdMicros, dailyRateUsdMicros },
    unobservedUsdMicros: meteredTotal(summary.uncovered),
  }
}
