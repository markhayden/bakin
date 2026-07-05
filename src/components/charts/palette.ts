/**
 * Chart series palette (#385) — the SDK chart kit's single source of series
 * color. Bakin renders dark-only (host index.html pins color-scheme: dark on
 * a #0f0e0e surface), so this is the dark-surface categorical set, validated
 * with the dataviz six-checks script (lightness band, chroma floor, adjacent
 * CVD ΔE, ≥3:1 contrast on the dark surface).
 *
 * Rules baked in here (do not "fix" them):
 * - The slot ORDER is the colorblind-safety mechanism — never reorder or
 *   cycle. It maximizes worst-case adjacent CVD separation.
 * - Color follows the entity: assign via assignSeriesColors over the full
 *   entity set so a filter that drops series never repaints the survivors.
 * - A 9th series is never a new hue — fold into "Other" (CHART_OTHER_COLOR).
 */

export const CHART_SERIES_COLORS = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
] as const

/** Muted, low-chroma gray for the folded "Other" series — never a hue slot. */
export const CHART_OTHER_COLOR = '#6b6963'

export const CHART_MAX_SERIES = CHART_SERIES_COLORS.length

/**
 * Deterministic entity → color map: entities sorted, slots assigned in fixed
 * order. Pass the FULL entity set (not the filtered view) so colors are
 * stable across filters and windows.
 */
export function assignSeriesColors(keys: string[]): Map<string, string> {
  const sorted = [...new Set(keys)].sort()
  const map = new Map<string, string>()
  sorted.forEach((key, i) => {
    map.set(key, i < CHART_SERIES_COLORS.length ? CHART_SERIES_COLORS[i]! : CHART_OTHER_COLOR)
  })
  return map
}
