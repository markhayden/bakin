'use client'

import { PluginLink, Sparkline, StatusBadge } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, Waypoints } from 'lucide-react'
import type {
  InteractionCategory,
  InteractionSummaryData,
} from '../types'
import type { OverviewTelemetry } from './overview-telemetry'

const CATEGORY_META: Record<InteractionCategory, {
  label: string
  colorClass: string
}> = {
  tools: { label: 'Tools', colorClass: 'bg-chart-1' },
  api: { label: 'API', colorClass: 'bg-chart-2' },
  agents: { label: 'Agents', colorClass: 'bg-chart-3' },
}

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
  const maximum = Math.max(1, ...destinations.map((destination) => destination.count))
  const trend = data?.timeBuckets.map((bucket) => bucket.count) ?? []
  const labels = data?.timeBuckets.map((bucket) => bucketLabel(bucket.start)) ?? []
  const coverage = data ? coverageDisplay(data) : null
  const mixLabel = data
    ? `Interaction mix: ${data.categories.map((category) => `${CATEGORY_META[category.key].label} ${category.count}`).join(', ')}`
    : 'Interaction mix'

  return (
    <section
      className="min-w-0 p-4"
      data-testid="overview-interactions"
      aria-labelledby="overview-interactions-title"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Waypoints className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 id="overview-interactions-title" className="font-semibold text-foreground">Interactions</h3>
          {coverage && (
            <span className="text-xs text-muted-foreground" aria-label={coverage.label} title={coverage.label}>
              {coverage.text}
            </span>
          )}
        </div>
        <PluginLink
          to="/health?tab=activity&activity_window=1h"
          aria-label="View recorded interaction activity"
          className="rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </PluginLink>
      </div>

      {resource.loading && !data ? (
        <div role="status" aria-label="Loading interaction activity" className="mt-4 space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : resource.error && !data ? (
        <div className="mt-4 flex min-h-32 flex-col items-center justify-center gap-2 text-center">
          <span className="text-sm text-muted-foreground">Interaction activity is unavailable.</span>
          {resource.onRetry && <Button size="xs" variant="outline" onClick={resource.onRetry}>Retry</Button>}
        </div>
      ) : !data || data.totals.count === 0 ? (
        <div className="mt-4 flex min-h-32 items-center justify-center text-sm text-muted-foreground">
          {data?.coverage.reason === 'process_restart'
            ? 'No recorded meaningful Bakin interactions since restart.'
            : data?.coverage.reason === 'buffer_limit'
              ? 'No recorded meaningful Bakin interactions in the available partial hour.'
              : 'No recorded meaningful Bakin interactions in the last hour.'}
        </div>
      ) : (
        <>
          <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @[24rem]/health:grid-cols-[minmax(0,1fr)_auto] @[24rem]/health:items-center">
            <div className="min-w-0">
              <strong className="block text-xl font-semibold tabular-nums text-foreground">
                {data.totals.count.toLocaleString()} interactions
              </strong>
              {data.totals.errors > 0 ? (
                <PluginLink
                  to="/health?tab=activity&activity_window=1h#activity-needs-attention"
                  className="mt-1 inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusBadge tone="destructive" variant="outline">
                    {`${data.totals.errors.toLocaleString()} failed${data.totals.unverified > 0 ? ` · ${unverifiedLabel(data.totals.unverified)}` : ''}`}
                  </StatusBadge>
                </PluginLink>
              ) : (
                <StatusBadge
                  tone={data.totals.unverified > 0 ? 'warning' : 'success'}
                  variant="outline"
                  className="mt-1"
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
                stroke="var(--chart-5)"
              />
            </div>
          </div>

          <div className="mt-3" role="group" aria-label={mixLabel}>
            <div className="flex h-2 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              {data.categories.filter((category) => category.count > 0).map((category) => (
                <span
                  key={category.key}
                  className={CATEGORY_META[category.key].colorClass}
                  style={{ flexGrow: category.count, flexBasis: 0 }}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {data.categories.map((category) => (
                <div key={category.key} className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span className={`size-2 shrink-0 rounded-full ${CATEGORY_META[category.key].colorClass}`} aria-hidden="true" />
                  <span className="truncate text-muted-foreground">{CATEGORY_META[category.key].label}</span>
                  <strong className="ml-auto tabular-nums text-foreground">{category.count.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{data.totals.foreground.toLocaleString()} foreground</span>
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
            <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
              {destinations.map((destination) => (
                <div
                  key={`${destination.category}:${destination.name}`}
                  data-testid="interaction-destination-row"
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 gap-y-1.5 text-xs @[24rem]/health:grid-cols-[minmax(0,1fr)_minmax(3rem,1fr)_6rem]"
                >
                  <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-muted-foreground" title={destination.name}>
                    <span className={`size-1.5 shrink-0 rounded-full ${CATEGORY_META[destination.category].colorClass}`} aria-hidden="true" />
                    <span className="truncate">{destinationName(destination.category, destination.name)}</span>
                  </span>
                  <span
                    data-testid="interaction-destination-bar"
                    className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-foreground/10 @[24rem]/health:col-span-1 @[24rem]/health:col-start-2 @[24rem]/health:row-start-1"
                    aria-hidden="true"
                  >
                    <span
                      className={`block h-full rounded-full ${destination.errors > 0 ? 'bg-destructive' : CATEGORY_META[destination.category].colorClass}`}
                      style={{ width: `${Math.max(3, (destination.count / maximum) * 100)}%` }}
                    />
                  </span>
                  <span
                    data-testid="interaction-destination-metric"
                    className="col-start-2 row-start-1 w-24 whitespace-nowrap text-right font-medium tabular-nums text-foreground @[24rem]/health:col-start-3"
                  >
                    {destination.count.toLocaleString()}{destination.errors > 0 ? ` · ${destination.errors} failed` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
