import { describe, expect, it } from 'bun:test'

import {
  monotonePathD,
  monotoneTangents,
  type CurvePoint,
} from '../../../packages/ui/src/charts/monotone-curve'

interface CubicSegment {
  from: CurvePoint
  c1: CurvePoint
  c2: CurvePoint
  to: CurvePoint
}

function parsePath(d: string): CubicSegment[] {
  const numbers = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? []
  expect(d.startsWith('M ')).toBe(true)
  expect((numbers.length - 2) % 6).toBe(0)
  const segments: CubicSegment[] = []
  let from: CurvePoint = { x: numbers[0]!, y: numbers[1]! }
  for (let index = 2; index < numbers.length; index += 6) {
    const segment: CubicSegment = {
      from,
      c1: { x: numbers[index]!, y: numbers[index + 1]! },
      c2: { x: numbers[index + 2]!, y: numbers[index + 3]! },
      to: { x: numbers[index + 4]!, y: numbers[index + 5]! },
    }
    segments.push(segment)
    from = segment.to
  }
  return segments
}

function evaluate(segment: CubicSegment, t: number): CurvePoint {
  const u = 1 - t
  return {
    x: u ** 3 * segment.from.x + 3 * u ** 2 * t * segment.c1.x + 3 * u * t ** 2 * segment.c2.x + t ** 3 * segment.to.x,
    y: u ** 3 * segment.from.y + 3 * u ** 2 * t * segment.c1.y + 3 * u * t ** 2 * segment.c2.y + t ** 3 * segment.to.y,
  }
}

function assertNoOvershoot(points: readonly CurvePoint[]): void {
  const segments = parsePath(monotonePathD(points))
  expect(segments).toHaveLength(points.length - 1)
  for (const segment of segments) {
    const low = Math.min(segment.from.y, segment.to.y) - 1e-9
    const high = Math.max(segment.from.y, segment.to.y) + 1e-9
    for (let step = 0; step <= 100; step += 1) {
      const { y } = evaluate(segment, step / 100)
      expect(y).toBeGreaterThanOrEqual(low)
      expect(y).toBeLessThanOrEqual(high)
    }
  }
}

describe('monotonePathD', () => {
  const spiky: CurvePoint[] = [
    { x: 0, y: 100 },
    { x: 50, y: 100 },
    { x: 100, y: 10 },
    { x: 150, y: 12 },
    { x: 200, y: 12 },
    { x: 250, y: 90 },
  ]

  it('passes exactly through every data point', () => {
    const segments = parsePath(monotonePathD(spiky))
    const knots = [segments[0]!.from, ...segments.map((segment) => segment.to)]
    expect(knots).toEqual(spiky)
  })

  it('never overshoots: each segment stays inside its endpoint y-range', () => {
    assertNoOvershoot(spiky)
  })

  it('never overshoots across flat runs, plateaus, and direction changes', () => {
    assertNoOvershoot([
      { x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 0 },
    ])
    assertNoOvershoot([
      { x: 0, y: 0 }, { x: 10, y: 80 }, { x: 20, y: 10 }, { x: 30, y: 70 }, { x: 40, y: 5 },
    ])
    assertNoOvershoot([
      { x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 100 }, { x: 30, y: 101 },
    ])
  })

  it('keeps monotone data monotone (no wiggles between rising points)', () => {
    const rising: CurvePoint[] = [
      { x: 0, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 30 }, { x: 30, y: 31 }, { x: 40, y: 90 },
    ]
    const segments = parsePath(monotonePathD(rising))
    let previous = -Infinity
    for (const segment of segments) {
      for (let step = 0; step <= 100; step += 1) {
        const { y } = evaluate(segment, step / 100)
        expect(y).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = y
      }
    }
  })

  it('renders two points as the straight linear segment', () => {
    const segments = parsePath(monotonePathD([{ x: 0, y: 0 }, { x: 30, y: 30 }]))
    expect(segments).toHaveLength(1)
    // Straight line: control points sit on the chord.
    expect(segments[0]!.c1).toEqual({ x: 10, y: 10 })
    expect(segments[0]!.c2).toEqual({ x: 20, y: 20 })
  })

  it('returns an empty path below two points', () => {
    expect(monotonePathD([])).toBe('')
    expect(monotonePathD([{ x: 5, y: 5 }])).toBe('')
  })
})

describe('monotoneTangents', () => {
  it('flattens tangents at local extrema so peaks stay peaks', () => {
    const tangents = monotoneTangents([
      { x: 0, y: 0 }, { x: 10, y: 100 }, { x: 20, y: 0 },
    ])
    expect(tangents[1]).toBe(0)
  })

  it('flattens both tangents across a zero secant', () => {
    const tangents = monotoneTangents([
      { x: 0, y: 0 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 100 },
    ])
    expect(tangents[1]).toBe(0)
    expect(tangents[2]).toBe(0)
  })
})
