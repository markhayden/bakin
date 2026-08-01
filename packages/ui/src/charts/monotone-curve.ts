/**
 * Monotone cubic interpolation (Fritsch–Carlson) for chart line paths.
 *
 * The smoothed curve passes exactly through every data point and never
 * overshoots: within each segment the interpolant stays inside the y-range of
 * its two endpoints, so a smoothed line can never imply a value outside the
 * data. Pure math, no DOM — unit-tested directly.
 */

export interface CurvePoint {
  x: number
  y: number
}

/**
 * Fritsch–Carlson tangents: secant-averaged slopes limited so each cubic
 * Hermite segment is monotone between its endpoints (no overshoot).
 */
export function monotoneTangents(points: readonly CurvePoint[]): number[] {
  const n = points.length
  if (n === 0) return []
  if (n === 1) return [0]

  // Secant slopes between consecutive points.
  const secants: number[] = []
  for (let index = 0; index < n - 1; index += 1) {
    const dx = points[index + 1]!.x - points[index]!.x
    secants.push(dx === 0 ? 0 : (points[index + 1]!.y - points[index]!.y) / dx)
  }

  // Initial tangents: one-sided at the ends, secant average interior — but a
  // sign change or flat secant forces a flat tangent (local extremum).
  const tangents: number[] = [secants[0]!]
  for (let index = 1; index < n - 1; index += 1) {
    const previous = secants[index - 1]!
    const next = secants[index]!
    tangents.push(previous * next <= 0 ? 0 : (previous + next) / 2)
  }
  tangents.push(secants[n - 2]!)

  // Fritsch–Carlson limiter: keep (alpha, beta) inside the circle of radius 3
  // so the Hermite segment cannot overshoot its endpoints.
  for (let index = 0; index < n - 1; index += 1) {
    const secant = secants[index]!
    if (secant === 0) {
      tangents[index] = 0
      tangents[index + 1] = 0
      continue
    }
    const alpha = tangents[index]! / secant
    const beta = tangents[index + 1]! / secant
    const magnitude = Math.hypot(alpha, beta)
    if (magnitude > 3) {
      const scale = 3 / magnitude
      tangents[index] = scale * alpha * secant
      tangents[index + 1] = scale * beta * secant
    }
  }

  return tangents
}

/**
 * SVG path for the monotone cubic through `points` as Hermite segments in
 * cubic Bézier form. Fewer than two points yields an empty string; exactly two
 * yields the straight segment the linear renderer would draw.
 */
export function monotonePathD(points: readonly CurvePoint[]): string {
  if (points.length < 2) return ''
  const tangents = monotoneTangents(points)
  const commands: string[] = [`M ${points[0]!.x} ${points[0]!.y}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    const dx = (to.x - from.x) / 3
    const c1x = from.x + dx
    const c1y = from.y + dx * tangents[index]!
    const c2x = to.x - dx
    const c2y = to.y - dx * tangents[index + 1]!
    commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`)
  }
  return commands.join(' ')
}
