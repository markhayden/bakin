'use client'

import { CompositionBar, RankedBarChart, Sparkline, type ChartDatum } from '@makinbakin/sdk/charts'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { ArrowUpRight, Waypoints } from 'lucide-react'
import type {
  InteractionCategory,
  InteractionSummaryData,
} from '../types'
import { interactionCategoryMeta } from './interaction-source-meta'
import type { OverviewTelemetry } from './overview-telemetry'

function destinationName(category: InteractionCategory, value: string): string {
  if (category === 'api') return value.replace(/^\/api\//, '')
  return value.replace(/^bakin_exec_/, '').replaceAll('_', ' ')
}

function bucketLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function absoluteCoverageStart(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
}

function coverageDisplay(data: InteractionSummaryData): { text: string; label: string } {
  const startsAt = absoluteCoverageStart(data.coverage.startsAt)
  if (data.coverage.reason === 'buffer_limit') {
    return {
      text: '· partial hour',
      label: `Recorded meaningful Bakin interactions are partial because of the recorder buffer limit, starting ${startsAt}.`,
    }
  }
  if (!data.coverage.hasFullWindow) {
    return {
      text: '· since restart',
      label: `Recorded meaningful Bakin interactions since restart at ${startsAt}.`,
    }
  }
  return {
    text: '· 1h',
    label: `Recorded meaningful Bakin interactions cover the full hour starting ${startsAt}.`,
  }
}

function unverifiedLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'result' : 'results'} not observed`
}

function visibleDestinations(data: InteractionSummaryData | null) {
  if (!data) return []
  const visible = data.topDestinations.slice(0, 3)
  if (data.totals.errors === 0 || visible.some((row) => row.errors > 0)) return visible

  const failed = [...data.topDestinations]
    .filter((row) => row.errors > 0)
    .sort((left, right) => right.errors - left.errors || right.count - left.count)[0]
  if (!failed) return visible
  if (visible.length < 3) return [...visible, failed]
  return [...visible.slice(0, 2), failed]
}

export function OverviewInteractions({
  resource,
}: {
  resource: OverviewTelemetry['interactions']
}) {
  const data = resource.data
  const destinations = visibleDestinations(data)
  const trend = data?.timeBuckets.map((bucket) => bucket.count) ?? []
  const labels = data?.timeBuckets.map((bucket) => bucketLabel(bucket.start)) ?? []
  const coverage = data ? coverageDisplay(data) : null
  const mixLabel = data
    ? `Interaction mix: ${data.categories.map((category) => `${interactionCategoryMeta(category.key).label} ${category.count}`).join(', ')}`
    : 'Interaction mix'
  const destinationData: ChartDatum[] = destinations.map((destination) => ({
    x: `${destination.category}:${destination.name}`,
    xLabel: destinationName(destination.category, destination.name),
    values: { count: destination.count, errors: destination.errors },
  }))

  return (
    <section
      className="min-w-0 p-bakin-4"
      data-testid="overview-interactions"
      aria-labelledby="overview-interactions-title"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-bakin-3 gap-y-bakin-1">
        <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          <Waypoints className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
          <h3 id="overview-interactions-title" className="font-bakin-typography-weight-semibold text-bakin-text-primary">Interactions</h3>
          {coverage && (
            <span className="text-bakin-typography-size-meta text-bakin-text-muted" aria-label={coverage.label} title={coverage.label}>
              {coverage.text}
            </span>
          )}
        </div>
        <PluginLink
          to="/health?tab=activity&activity_window=1h"
          aria-label="View recorded interaction activity"
          className="rounded-bakin-control text-bakin-signal-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
        >
          <ArrowUpRight className="size-bakin-4" aria-hidden="true" />
        </PluginLink>
      </div>

      {resource.loading && !data ? (
        <div role="status" aria-label="Loading interaction activity" className="mt-bakin-4 space-y-bakin-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : resource.error && !data ? (
        <SystemState
          kind="error"
          scope="section"
          headingLevel={4}
          title="Interaction activity is unavailable."
          action={resource.onRetry
            ? <Button size="xs" variant="outline" onClick={resource.onRetry}>Retry</Button>
            : undefined}
        />
      ) : !data || data.totals.count === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          headingLevel={4}
          title={data?.coverage.reason === 'process_restart'
            ? 'No recorded meaningful Bakin interactions since restart.'
            : data?.coverage.reason === 'buffer_limit'
              ? 'No recorded meaningful Bakin interactions in the available partial hour.'
              : 'No recorded meaningful Bakin interactions in the last hour.'}
        />
      ) : (
        <>
          <div className="mt-bakin-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-bakin-3 @[24rem]/health:grid-cols-[minmax(0,1fr)_auto] @[24rem]/health:items-center">
            <div className="min-w-0">
              <strong className="block text-bakin-typography-size-title font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">
                {data.totals.count.toLocaleString()} interactions
              </strong>
              {data.totals.errors > 0 ? (
                <PluginLink
                  to="/health?tab=activity&activity_window=1h#activity-needs-attention"
                  className="mt-bakin-1 inline-flex rounded-bakin-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
                >
                  <StatusBadge tone="danger" variant="outline">
                    {`${data.totals.errors.toLocaleString()} failed${data.totals.unverified > 0 ? ` · ${unverifiedLabel(data.totals.unverified)}` : ''}`}
                  </StatusBadge>
                </PluginLink>
              ) : (
                <StatusBadge
                  tone={data.totals.unverified > 0 ? 'attention' : 'success'}
                  variant="outline"
                  className="mt-bakin-1"
                >
                  {data.totals.unverified > 0 ? unverifiedLabel(data.totals.unverified) : '0 failed'}
                </StatusBadge>
              )}
            </div>
            <div className="min-w-0 justify-self-end">
              <Sparkline
                values={trend}
                labels={labels}
                width={116}
                height={36}
                label={coverage?.label ?? 'Recorded meaningful Bakin interactions'}
                formatValue={(value) => Math.round(value).toLocaleString()}
              />
            </div>
          </div>

          <div className="mt-bakin-3" role="group" aria-label={mixLabel}>
            <CompositionBar
              data={data.categories.map((category) => ({
                key: category.key,
                label: interactionCategoryMeta(category.key).label,
                value: category.count,
              }))}
              label="Interaction mix"
              formatValue={(value) => value.toLocaleString()}
            />
          </div>

          <p className="mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            <span className="font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary">{data.totals.foreground.toLocaleString()} foreground</span>
            {' · '}
            <span className="tabular-nums">{data.totals.background.toLocaleString()} background</span>
            {' · '}
            <span
              title="Successful routine polling and static delivery are excluded; failures always count."
              aria-label="Successful routine polling and static delivery are excluded; failures always count."
            >
              monitoring excluded
            </span>
          </p>

          {destinations.length > 0 && (
            <div className="mt-bakin-3 border-t border-bakin-border-subtle pt-bakin-3">
              <RankedBarChart
                data={destinationData}
                series={{ key: 'count', label: 'calls' }}
                secondary={{ key: 'errors', label: 'failed' }}
                label="Busiest interaction destinations"
                formatValue={(value) => value.toLocaleString()}
                compactData
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
