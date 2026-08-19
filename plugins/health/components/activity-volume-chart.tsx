'use client'

import { AreaChart, BarChart, ChartDataTable, ChartExplainer, type ChartSeries } from '@makinbakin/sdk/charts'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import { Alert, AlertDescription } from '@makinbakin/sdk/ui'
import type { InteractionCoverage, UsageFeedData } from '../types'
import { coveredActivityBuckets } from './activity-time-buckets'

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const VOLUME_SERIES: readonly ChartSeries[] = [
  { key: 'other', label: 'Other outcomes' },
  { key: 'failed', label: 'Failed' },
]

/** Beyond this many intervals, stacked columns get unreadable — long windows render as a stacked area. */
const LONG_WINDOW_BUCKETS = 12

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
        <h3 id="activity-volume-title">Activity over time</h3>
        <p className="text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
          Calls recorded in each interval of the selected window, split by result.
        </p>
        {!coverage.hasFullWindow && (
          <Alert tone="attention">
            <AlertDescription>
              Partial history since {bucketLabel(coverage.startsAt)}; intervals entirely before that are omitted.
            </AlertDescription>
          </Alert>
        )}
      </Stack>
      <Grid layout="main-aside" gap="section" align="start">
        <div className="min-w-0">
          {visibleBuckets.length > LONG_WINDOW_BUCKETS ? (
            <AreaChart
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
              series={VOLUME_SERIES}
              height={120}
              formatValue={(value) => Math.round(value).toLocaleString()}
              emptyLabel="No activity was recorded in this window."
              compactData
            />
          ) : (
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
              series={VOLUME_SERIES}
              height={120}
              formatValue={(value) => Math.round(value).toLocaleString()}
              emptyLabel="No activity was recorded in this window."
              showDataTable={false}
            />
          )}
        </div>
        {visibleBuckets.length <= LONG_WINDOW_BUCKETS && (
          <ChartDataTable
            className="mt-bakin-0"
            data={[...visibleBuckets].reverse().map((bucket) => ({
              x: bucket.start,
              xLabel: bucketLabel(bucket.start),
              values: {
                other: Math.max(0, bucket.count - bucket.failureCount),
                failed: bucket.failureCount,
              },
            }))}
            series={VOLUME_SERIES}
            caption="Activity over time data"
            defaultOpen
            renderTable={(context) => (
              <div className="max-h-64 min-w-0 overflow-auto">
                <table className="w-full text-bakin-typography-size-meta tabular-nums">
                  <caption className="sr-only">{context.caption}</caption>
                  <thead className="sticky top-0 bg-bakin-canvas-default text-bakin-text-muted">
                    <tr className="border-b border-bakin-border-subtle">
                      <th scope="col" className="px-bakin-3 py-bakin-2 text-left font-bakin-typography-weight-medium">Interval</th>
                      {context.series.map((item) => (
                        <th key={item.key} scope="col" className="px-bakin-3 py-bakin-2 text-right font-bakin-typography-weight-medium">{item.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {context.data.map((datum) => (
                      <tr key={datum.x} className="border-b border-bakin-border-subtle last:border-b-0">
                        <th scope="row" className="whitespace-nowrap px-bakin-3 py-bakin-2 text-left font-bakin-typography-weight-medium text-bakin-text-primary">
                          <time dateTime={datum.x}>{datum.xLabel ?? datum.x}</time>
                        </th>
                        {context.series.map((item) => (
                          <td key={item.key} className="px-bakin-3 py-bakin-2 text-right text-bakin-text-primary">
                            {context.formatValue(datum.values[item.key] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        )}
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
