'use client'

import { LineChart } from '@makinbakin/sdk/components'
import type { UsageFeedData } from '../types'

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ActivityFailureTrend({ buckets }: { buckets: UsageFeedData['timeBuckets'] }) {
  return (
    <LineChart
      label="Activity and failures over time"
      description="Total recorded activity and failed activity in each time bucket. Exact values are available below the chart."
      data={buckets.map((bucket) => ({
        x: bucket.start,
        xLabel: bucketLabel(bucket.start),
        values: { activity: bucket.count, failures: bucket.failureCount },
      }))}
      series={[
        { key: 'activity', label: 'All activity', color: 'var(--chart-2)' },
        { key: 'failures', label: 'Failures', color: 'var(--destructive)' },
      ]}
      height={190}
    />
  )
}
