/**
 * Shared axis and series-geometry helpers for the hand-rolled SVG chart kit.
 * Chart-specific value semantics (stacked coercion, negative handling) stay
 * local to the chart that owns them.
 */

/** Non-negative reported value; negative and non-finite readings are explicit gaps. */
export function reportedValue(value: number | undefined): number | null {
  return Number.isFinite(value) && value! >= 0 ? value! : null
}

/** Thin dense x-axes to at most ~6 labels while always keeping the last one. */
export function shouldRenderXLabel(index: number, count: number): boolean {
  if (count <= 6) return true
  return index === count - 1 || index % Math.ceil(count / 6) === 0
}

/** Ellipsize long axis labels so dense axes stay legible. */
export function axisLabel(label: string): string {
  return label.length <= 14 ? label : `${label.slice(0, 13)}…`
}

/** Split a point series on gaps (nulls) into contiguous drawable runs. */
export function contiguousSegments<P>(points: readonly (P | null)[]): P[][] {
  const segments: P[][] = []
  let current: P[] = []
  for (const point of points) {
    if (point) current.push(point)
    else if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}
