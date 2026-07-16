'use client'

import { ChartExplainer, LineChart } from '@makinbakin/sdk/components'
import type { InteractionCoverage, UsageFeedData } from '../types'
import { coveredActivityBuckets } from './activity-time-buckets'

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ActivityFailureTrend({
  buckets,
  coverage,
}: {
  buckets: UsageFeedData['timeBuckets']
  coverage: InteractionCoverage
}) {
  const visibleBuckets = coveredActivityBuckets(buckets, coverage)
  const latestFailures = visibleBuckets.at(-1)?.failureCount ?? 0
  const peakFailures = Math.max(0, ...visibleBuckets.map((bucket) => bucket.failureCount))

  return (
    <div className="w-full max-w-4xl" data-activity-failure-trend-plot>
      <LineChart
        label="Failures over time"
        description="The number of recorded actions that failed in each part of the selected window. Exact values are available below the chart."
        data={visibleBuckets.map((bucket) => ({
          x: bucket.start,
          xLabel: bucketLabel(bucket.start),
          values: { failures: bucket.failureCount },
        }))}
        series={[{ key: 'failures', label: 'Failures', color: 'var(--destructive)' }]}
        height={120}
        formatValue={(value) => Math.round(value).toLocaleString()}
      />
      {!coverage.hasFullWindow && (
        <p className="mt-2 text-xs text-warning">
          Partial history since {bucketLabel(coverage.startsAt)}; intervals entirely before that are omitted.
        </p>
      )}
      <ChartExplainer>
        The latest interval had {latestFailures.toLocaleString()} {latestFailures === 1 ? 'failure' : 'failures'}.
        {' '}The highest interval had {peakFailures.toLocaleString()}.
      </ChartExplainer>
    </div>
  )
}
