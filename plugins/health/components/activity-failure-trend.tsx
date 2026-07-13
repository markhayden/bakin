'use client'

import { ChartExplainer, LineChart } from '@makinbakin/sdk/components'
import type { UsageFeedData } from '../types'

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ActivityFailureTrend({ buckets }: { buckets: UsageFeedData['timeBuckets'] }) {
  const latestFailures = buckets.at(-1)?.failureCount ?? 0
  const peakFailures = Math.max(0, ...buckets.map((bucket) => bucket.failureCount))

  return (
    <div className="w-full max-w-4xl" data-activity-failure-trend-plot>
      <LineChart
        label="Failures over time"
        description="The number of recorded actions that failed in each part of the selected window. Exact values are available below the chart."
        data={buckets.map((bucket) => ({
          x: bucket.start,
          xLabel: bucketLabel(bucket.start),
          values: { failures: bucket.failureCount },
        }))}
        series={[{ key: 'failures', label: 'Failures', color: 'var(--destructive)' }]}
        height={120}
        formatValue={(value) => Math.round(value).toLocaleString()}
      />
      <ChartExplainer>
        The latest interval had {latestFailures.toLocaleString()} {latestFailures === 1 ? 'failure' : 'failures'}.
        {' '}The highest interval had {peakFailures.toLocaleString()}.
      </ChartExplainer>
    </div>
  )
}
