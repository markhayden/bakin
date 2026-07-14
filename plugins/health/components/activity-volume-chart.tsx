'use client'

import { BarChart, ChartExplainer } from '@makinbakin/sdk/components'
import type { InteractionCoverage, UsageFeedData } from '../types'

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Stacked activity volume across the window's time buckets. The buckets only
 * carry count + failureCount, so the honest split is failed vs everything
 * else (succeeded, canceled, or unverified).
 */
export function ActivityVolumeChart({
  buckets,
  coverage,
}: {
  buckets: UsageFeedData['timeBuckets']
  coverage: InteractionCoverage
}) {
  const coverageStart = Date.parse(coverage.startsAt)
  const visibleBuckets = coverage.hasFullWindow || !Number.isFinite(coverageStart)
    ? buckets
    : buckets.filter((bucket, index) => {
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
  const total = visibleBuckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const failed = visibleBuckets.reduce((sum, bucket) => sum + bucket.failureCount, 0)
  const busiest = visibleBuckets.reduce(
    (best, bucket) => (bucket.count > (best?.count ?? 0) ? bucket : best),
    null as UsageFeedData['timeBuckets'][number] | null,
  )

  return (
    <section
      aria-labelledby="activity-volume-title"
      className="rounded-xl border border-border/80 bg-card p-4"
      data-testid="activity-volume-chart"
    >
      <div>
        <h3 id="activity-volume-title" className="font-semibold">Activity over time</h3>
        <p className="text-sm text-muted-foreground">
          Calls recorded in each interval of the selected window, split by result.
        </p>
        {!coverage.hasFullWindow && (
          <p className="mt-1 text-xs text-warning">
            Partial history since {bucketLabel(coverage.startsAt)}; intervals entirely before that are omitted.
          </p>
        )}
      </div>
      <div className="mt-3 max-w-4xl">
        <BarChart
          stacked
          label="Activity over time"
          description="Recorded calls per interval. Other outcomes include succeeded, canceled, and unverified results; failures stack on top. Exact values are available below the chart."
          data={visibleBuckets.map((bucket) => ({
            x: bucket.start,
            xLabel: bucketLabel(bucket.start),
            values: {
              other: Math.max(0, bucket.count - bucket.failureCount),
              failed: bucket.failureCount,
            },
          }))}
          series={[
            { key: 'other', label: 'Other outcomes', color: 'var(--chart-2)' },
            { key: 'failed', label: 'Failed', color: 'var(--destructive)' },
          ]}
          height={120}
          formatValue={(value) => Math.round(value).toLocaleString()}
          emptyLabel="No activity was recorded in this window."
        />
      </div>
      {visibleBuckets.length > 0 && (
        <ChartExplainer>
          {total.toLocaleString()} {total === 1 ? 'call' : 'calls'} in this window
          {failed > 0 ? `, ${failed.toLocaleString()} failed` : ' with no failures'}.
          {busiest && busiest.count > 0
            ? ` The busiest interval started at ${bucketLabel(busiest.start)} with ${busiest.count.toLocaleString()} ${busiest.count === 1 ? 'call' : 'calls'}.`
            : ''}
        </ChartExplainer>
      )}
    </section>
  )
}
