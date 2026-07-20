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
