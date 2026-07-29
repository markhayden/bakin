'use client'

import { BarChart, ChartExplainer } from '@makinbakin/sdk/charts'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import type { InteractionCoverage, UsageFeedData } from '../types'
import { coveredActivityBuckets } from './activity-time-buckets'

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
  const visibleBuckets = coveredActivityBuckets(buckets, coverage)
  const total = visibleBuckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const failed = visibleBuckets.reduce((sum, bucket) => sum + bucket.failureCount, 0)
  const busiest = visibleBuckets.reduce(
    (best, bucket) => (bucket.count > (best?.count ?? 0) ? bucket : best),
    null as UsageFeedData['timeBuckets'][number] | null,
  )

  return (
    <Section
      aria-labelledby="activity-volume-title"
      divider="top"
      spacing="compact"
      data-testid="activity-volume-chart"
      data-chart-layout="split"
    >
      <Stack gap="dense">
        <h3 id="activity-volume-title" className="font-semibold">Activity over time</h3>
        <p className="text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
          Calls recorded in each interval of the selected window, split by result.
        </p>
        {!coverage.hasFullWindow && (
          <p className="text-bakin-typography-size-meta text-bakin-signal-highlight">
            Partial history since {bucketLabel(coverage.startsAt)}; intervals entirely before that are omitted.
          </p>
        )}
      </Stack>
      <Grid layout="main-aside" gap="section" align="start">
        <div className="min-w-0">
          <BarChart
            stacked
            label="Activity over time"
            description="Recorded calls per interval. Other outcomes include succeeded, canceled, and unverified results; failures stack on top. Values are listed beside the chart."
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
            showDataTable={false}
          />
        </div>
        <div className="min-w-0 overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-bakin-typography-size-meta tabular-nums">
              <caption className="sr-only">Activity over time data</caption>
              <thead className="sticky top-0 bg-bakin-canvas-default text-bakin-text-muted">
                <tr className="border-b border-bakin-border-subtle">
                  <th scope="col" className="px-bakin-3 py-bakin-2 text-left font-medium">Interval</th>
                  <th scope="col" className="px-bakin-3 py-bakin-2 text-right font-medium">Other outcomes</th>
                  <th scope="col" className="px-bakin-3 py-bakin-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {[...visibleBuckets].reverse().map((bucket) => (
                  <tr key={bucket.start} className="border-b border-bakin-border-subtle last:border-b-0">
                    <th scope="row" className="whitespace-nowrap px-bakin-3 py-bakin-2 text-left font-medium text-bakin-text-primary">
                      <time dateTime={bucket.start}>{bucketLabel(bucket.start)}</time>
                    </th>
                    <td className="px-bakin-3 py-bakin-2 text-right text-bakin-text-primary">
                      {Math.max(0, bucket.count - bucket.failureCount).toLocaleString()}
                    </td>
                    <td className="px-bakin-3 py-bakin-2 text-right text-bakin-text-primary">
                      {bucket.failureCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Grid>
      {visibleBuckets.length > 0 && (
        <ChartExplainer>
          {total.toLocaleString()} {total === 1 ? 'call' : 'calls'} in this window
          {failed > 0 ? `, ${failed.toLocaleString()} failed` : ' with no failures'}.
          {busiest && busiest.count > 0
            ? ` The busiest interval started at ${bucketLabel(busiest.start)} with ${busiest.count.toLocaleString()} ${busiest.count === 1 ? 'call' : 'calls'}.`
            : ''}
        </ChartExplainer>
      )}
    </Section>
  )
}
