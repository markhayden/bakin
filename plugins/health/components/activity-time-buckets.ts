import type { InteractionCoverage, UsageFeedData } from '../types'

/**
 * Exclude intervals wholly before the recorder's trustworthy coverage start.
 * The overlapping interval remains because it may contain observed activity.
 */
export function coveredActivityBuckets(
  buckets: UsageFeedData['timeBuckets'],
  coverage: InteractionCoverage,
): UsageFeedData['timeBuckets'] {
  const coverageStart = Date.parse(coverage.startsAt)
  if (coverage.hasFullWindow || !Number.isFinite(coverageStart)) return buckets
  if (buckets.length <= 1) return buckets

  return buckets.filter((bucket, index) => {
    const start = Date.parse(bucket.start)
    const nextStart = Date.parse(buckets[index + 1]?.start ?? '')
    const previousStart = Date.parse(buckets[index - 1]?.start ?? '')
    const end = Number.isFinite(nextStart)
      ? nextStart
      : Number.isFinite(start) && Number.isFinite(previousStart)
        ? start + (start - previousStart)
        : start
    return Number.isFinite(end) && end > coverageStart
  })
}
