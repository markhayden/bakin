/**
 * Fixed categorical order validated for adjacent color-vision-deficiency
 * separation on Bakin's dark canvas. Labels and exact values still carry
 * meaning; these colors are reinforcement, never the only distinction.
 */
export const CHART_SERIES_COLORS = [
  'var(--bakin-color-data-series-1)',
  'var(--bakin-color-data-series-2)',
  'var(--bakin-color-data-series-3)',
  'var(--bakin-color-data-series-4)',
  'var(--bakin-color-data-series-5)',
  'var(--bakin-color-data-series-6)',
  'var(--bakin-color-data-series-7)',
  'var(--bakin-color-data-series-8)',
] as const

/** Low-chroma slot for every entity folded into a visible “Other” group. */
export const CHART_OTHER_COLOR = 'var(--bakin-color-data-other)'

/**
 * Vocabulary for outcome-meaning series. A series that MEANS good/bad/warning
 * wears a status step; a series that is merely “series 4” wears a categorical
 * slot — never both in one chart. `neutral` is the honest step for outcome
 * series that make no good-or-bad claim (canceled, unattributed remainder).
 */
export type ChartTone = 'success' | 'danger' | 'attention' | 'neutral'

/**
 * Status chart-fill steps. The success/danger/attention trio is re-stepped in
 * lightness from Bakin's status hues and frozen only after passing the dataviz
 * palette validator on the dark chart surfaces (all-pairs CVD ΔE ≥ 8, normal
 * ΔE ≥ 15, ≥ 3:1 contrast); the attention step is deliberately separated from
 * the categorical amber slot. Changing any value requires re-validation — see
 * tests/ui/charts/chart-status-tokens.test.ts.
 */
export const CHART_TONE_COLORS: Record<ChartTone, string> = {
  success: 'var(--bakin-color-data-status-success)',
  danger: 'var(--bakin-color-data-status-danger)',
  attention: 'var(--bakin-color-data-status-attention)',
  neutral: 'var(--bakin-color-data-status-neutral)',
}

/** Resolve one tone to its frozen status chart-fill step. */
export function chartToneColor(tone: ChartTone): string {
  return CHART_TONE_COLORS[tone]
}

export const CHART_MAX_SERIES = CHART_SERIES_COLORS.length

/**
 * Assign the full entity set, not a filtered view. Sorting once against the
 * complete set prevents surviving series from changing color across filters.
 */
export function assignSeriesColors(keys: readonly string[]): Map<string, string> {
  const sorted = [...new Set(keys)].sort()
  const colors = new Map<string, string>()

  sorted.forEach((key, index) => {
    colors.set(key, index < CHART_MAX_SERIES ? CHART_SERIES_COLORS[index]! : CHART_OTHER_COLOR)
  })

  return colors
}
