'use client'

import { Grid, Section } from '@makinbakin/sdk/layout'
import { ChevronRight } from 'lucide-react'
import { isAttributedAgentRow } from '../lib/activity-feed-compat'
import type { UsageFeedData, UsageKind } from '../types'
import { formatActivityName } from './activity-row'
import { INTERACTION_SOURCE_META } from './interaction-source-meta'

const DESTINATION_ROW_LIMIT = 10
const AGENT_ROW_LIMIT = 8

export type ActivityFailureSelection = {
  kind?: UsageKind
  destination: string
  method?: string | null
}

interface BreakdownRow {
  key: string
  label: string
  count: number
  errors: number
  detail?: string | null
  sourceKind?: UsageKind
  failureSelection?: ActivityFailureSelection
}

function BreakdownPanel({
  title,
  sub,
  rows,
  barColor,
  emptyLabel,
  sourceAware = false,
  onReviewFailures,
}: {
  title: string
  sub: string
  rows: BreakdownRow[]
  barColor: string
  emptyLabel: string
  sourceAware?: boolean
  onReviewFailures?: (selection: ActivityFailureSelection) => void
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.count))

  return (
    <div className="min-w-0">
      <h4 className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
        {title}
      </h4>
      <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{sub}</p>
      {rows.length === 0 ? (
        <p className="mt-bakin-4 text-bakin-typography-size-body text-bakin-text-muted">{emptyLabel}</p>
      ) : (
        <ul className="mt-bakin-3 space-y-bakin-3" aria-label={title}>
          {rows.map((row) => {
            const width = row.count === 0 ? 0 : Math.max(3, (row.count / maximum) * 100)
            const failureWidth = row.count === 0 ? 0 : (row.errors / row.count) * 100
            const source = row.sourceKind ? INTERACTION_SOURCE_META[row.sourceKind] : null
            const sourceLabel = source?.label
            const accessibleLabel = sourceLabel ? `${sourceLabel} · ${row.label}` : row.label
            const rowBarColor = sourceAware ? source?.barColor ?? 'var(--muted-foreground)' : barColor
            const failureLabel = `Review ${row.errors.toLocaleString()} failed ${sourceLabel ? `${sourceLabel} ` : ''}${row.label} ${row.errors === 1 ? 'call' : 'calls'}`
            const Icon = source?.icon
            const failureSelection = row.failureSelection
            return (
              <li
                key={row.key}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs"
                aria-label={accessibleLabel}
                {...(sourceAware ? { 'data-source-kind': row.sourceKind ?? 'unknown' } : {})}
                data-testid="activity-breakdown-row"
              >
                <span className="flex min-w-0 items-center gap-bakin-2 text-bakin-text-muted">
                  {Icon && source && (
                    <>
                      <Icon className={`size-3.5 shrink-0 ${source.iconColorClass}`} aria-hidden="true" />
                      <span className="shrink-0 font-bakin-typography-weight-medium text-bakin-text-primary">{source.label}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span className="min-w-0 truncate" title={row.label}>
                    {row.label}
                    {row.detail && <span className="text-bakin-text-muted"> · {row.detail}</span>}
                  </span>
                </span>
                <span className="flex items-center justify-end gap-bakin-1 whitespace-nowrap text-right font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary">
                  <span>{row.count.toLocaleString()}</span>
                  {row.errors > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      {failureSelection && onReviewFailures ? (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-bakin-1 rounded-bakin-control text-bakin-signal-danger underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
                          aria-label={failureLabel}
                          onClick={() => onReviewFailures(failureSelection)}
                        >
                          {row.errors.toLocaleString()} failed
                          <ChevronRight className="size-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-bakin-signal-danger">{row.errors.toLocaleString()} failed</span>
                      )}
                    </>
                  )}
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-bakin-pill bg-bakin-surface-default" aria-hidden="true">
                  <span
                    className="relative block h-full overflow-hidden rounded-bakin-pill"
                    style={{ width: `${width}%`, backgroundColor: rowBarColor }}
                    {...(sourceAware ? { 'data-source-bar': true } : {})}
                  >
                    {row.errors > 0 && (
                      <span className="absolute inset-y-0 right-0 bg-bakin-signal-danger" style={{ width: `${failureWidth}%` }} />
                    )}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Side-by-side call breakdowns: where calls went and which agents made them. */
export function ActivityBreakdown({
  data,
  onReviewFailures,
}: {
  data: UsageFeedData
  onReviewFailures?: (selection: ActivityFailureSelection) => void
}) {
  const destinations: BreakdownRow[] = data.topByName
    .slice(0, DESTINATION_ROW_LIMIT)
    .map((row) => ({
      key: `${row.kind ?? 'unknown'}:${row.method ?? ''}:${row.name}`,
      label: `${row.method ? `${row.method} ` : ''}${formatActivityName(row.name)}`,
      count: row.count,
      errors: row.errors,
      detail: row.medianDurationMs === null ? null : `${row.medianDurationMs.toLocaleString()} ms median`,
      ...(row.kind ? { sourceKind: row.kind } : {}),
      failureSelection: {
        ...(row.kind ? { kind: row.kind } : {}),
        destination: row.name,
        ...(row.method !== undefined ? { method: row.method } : {}),
      },
    }))

  const agents: BreakdownRow[] = [...data.byAgent]
    .filter(isAttributedAgentRow)
    .sort((left, right) => right.count - left.count)
    .slice(0, AGENT_ROW_LIMIT)
    .map((row) => ({
      key: row.agent,
      label: row.agent,
      count: row.count,
      errors: row.errors,
    }))

  return (
    <Section
      aria-labelledby="activity-breakdown-title"
      divider="top"
      spacing="compact"
      data-testid="activity-breakdown"
    >
      <div>
        <h3 id="activity-breakdown-title" className="font-bakin-typography-weight-semibold text-bakin-text-primary">
          Call breakdown
        </h3>
        <p className="mt-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">
          Where recorded calls went and which agents generated them.
        </p>
      </div>
      <Grid layout="split" gap="section" align="start">
        <BreakdownPanel
          title="Top destinations"
          sub={data.capabilities?.sourceBalancedActivity === true
            ? 'Top calls from each source, balanced so quieter work stays visible.'
            : 'The tools, routes, and runs called most in this window.'}
          rows={destinations}
          barColor="var(--chart-5)"
          emptyLabel="No destinations were recorded in this window."
          sourceAware
          onReviewFailures={onReviewFailures}
        />
        <BreakdownPanel
          title="Busiest agents"
          sub="Which agents drove the activity."
          rows={agents}
          barColor="var(--chart-3)"
          emptyLabel="No agent-attributed activity in this window."
        />
      </Grid>
    </Section>
  )
}
