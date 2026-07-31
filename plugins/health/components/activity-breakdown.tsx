'use client'

import { RankedBarChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Grid, Section } from '@makinbakin/sdk/layout'
import { Button } from '@makinbakin/sdk/ui'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
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
  medianDurationMs?: number | null
  sourceKind?: UsageKind
  failureSelection?: ActivityFailureSelection
}

function breakdownChartData(rows: BreakdownRow[], withMedian: boolean): ChartDatum[] {
  return rows.map((row) => {
    const source = row.sourceKind ? INTERACTION_SOURCE_META[row.sourceKind] : null
    const base = source ? `${source.label} · ${row.label}` : row.label
    const median = withMedian && row.medianDurationMs !== null && row.medianDurationMs !== undefined
      ? ` · ${row.medianDurationMs.toLocaleString()} ms median`
      : ''
    return {
      x: row.key,
      xLabel: `${base}${median}`,
      values: { count: row.count, errors: row.errors },
    }
  })
}

function BreakdownPanel({
  title,
  sub,
  children,
}: {
  title: string
  sub: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <h4 className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
        {title}
      </h4>
      <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{sub}</p>
      <div className="mt-bakin-3">{children}</div>
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
      medianDurationMs: row.medianDurationMs,
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

  const failedDestinations = destinations.filter(
    (row) => row.errors > 0 && row.failureSelection !== undefined,
  )

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
        >
          <RankedBarChart
            data={breakdownChartData(destinations, true)}
            series={{ key: 'count', label: 'calls' }}
            secondary={{ key: 'errors', label: 'failed' }}
            label="Top destinations"
            formatValue={(value) => value.toLocaleString()}
            emptyLabel="No destinations were recorded in this window."
            compactData
          />
          {onReviewFailures && failedDestinations.length > 0 && (
            <ul className="mt-bakin-3 space-y-bakin-1" aria-label="Review failed destinations">
              {failedDestinations.map((row) => {
                const source = row.sourceKind ? INTERACTION_SOURCE_META[row.sourceKind] : null
                const failureLabel = `Review ${row.errors.toLocaleString()} failed ${source ? `${source.label} ` : ''}${row.label} ${row.errors === 1 ? 'call' : 'calls'}`
                return (
                  <li key={row.key} className="min-w-0">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="max-w-full justify-start px-bakin-0 text-bakin-signal-danger underline-offset-2 hover:bg-transparent hover:underline"
                      aria-label={failureLabel}
                      onClick={() => onReviewFailures(row.failureSelection!)}
                    >
                      <span className="min-w-0 truncate">{failureLabel}</span>
                      <ChevronRight className="size-bakin-3 shrink-0" aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </BreakdownPanel>
        <BreakdownPanel
          title="Busiest agents"
          sub="Which agents drove the activity."
        >
          <RankedBarChart
            data={breakdownChartData(agents, false)}
            series={{ key: 'count', label: 'calls' }}
            secondary={{ key: 'errors', label: 'failed' }}
            label="Busiest agents"
            formatValue={(value) => value.toLocaleString()}
            emptyLabel="No agent-attributed activity in this window."
            compactData
          />
        </BreakdownPanel>
      </Grid>
    </Section>
  )
}
