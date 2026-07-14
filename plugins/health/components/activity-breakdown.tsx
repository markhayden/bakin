'use client'

import { Bot, Braces, ChevronRight, Wrench } from 'lucide-react'
import type { UsageFeedData, UsageKind } from '../types'
import { formatActivityName } from './activity-row'

const ROW_LIMIT = 8

const SOURCE_META: Record<UsageKind, {
  label: string
  icon: typeof Wrench
  iconColor: string
  barColor: string
}> = {
  mcp: { label: 'MCP', icon: Wrench, iconColor: 'text-chart-1', barColor: 'var(--chart-1)' },
  rest: { label: 'API', icon: Braces, iconColor: 'text-chart-2', barColor: 'var(--chart-2)' },
  agent: { label: 'Agent', icon: Bot, iconColor: 'text-chart-3', barColor: 'var(--chart-3)' },
}

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
    <div className="min-w-0 bg-card p-4">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2.5" aria-label={title}>
          {rows.map((row) => {
            const width = row.count === 0 ? 0 : Math.max(3, (row.count / maximum) * 100)
            const failureWidth = row.count === 0 ? 0 : (row.errors / row.count) * 100
            const source = row.sourceKind ? SOURCE_META[row.sourceKind] : null
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
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  {Icon && source && (
                    <>
                      <Icon className={`size-3.5 shrink-0 ${source.iconColor}`} aria-hidden="true" />
                      <span className="shrink-0 font-medium text-foreground/80">{source.label}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span className="min-w-0 truncate" title={row.label}>
                    {row.label}
                    {row.detail && <span className="text-muted-foreground/70"> · {row.detail}</span>}
                  </span>
                </span>
                <span className="flex items-center justify-end gap-1 whitespace-nowrap text-right font-medium tabular-nums text-foreground">
                  <span>{row.count.toLocaleString()}</span>
                  {row.errors > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      {failureSelection && onReviewFailures ? (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={failureLabel}
                          onClick={() => onReviewFailures(failureSelection)}
                        >
                          {row.errors.toLocaleString()} failed
                          <ChevronRight className="size-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-destructive">{row.errors.toLocaleString()} failed</span>
                      )}
                    </>
                  )}
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                  <span
                    className="relative block h-full overflow-hidden rounded-full"
                    style={{ width: `${width}%`, backgroundColor: rowBarColor }}
                    {...(sourceAware ? { 'data-source-bar': true } : {})}
                  >
                    {row.errors > 0 && (
                      <span className="absolute inset-y-0 right-0 bg-destructive" style={{ width: `${failureWidth}%` }} />
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
    .slice(0, ROW_LIMIT)
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
    .filter((row) => row.agent !== 'unknown')
    .sort((left, right) => right.count - left.count)
    .slice(0, ROW_LIMIT)
    .map((row) => ({
      key: row.agent,
      label: row.agent,
      count: row.count,
      errors: row.errors,
    }))

  return (
    <section
      aria-labelledby="activity-breakdown-title"
      className="overflow-hidden rounded-xl border border-border/80 bg-border/70"
      data-testid="activity-breakdown"
    >
      <div className="bg-card px-4 py-3">
        <h3 id="activity-breakdown-title" className="font-semibold">Call breakdown</h3>
      </div>
      <div className="grid gap-px @[58rem]/health:grid-cols-2">
        <BreakdownPanel
          title="Top destinations"
          sub="The tools, routes, and runs called most in this window."
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
      </div>
    </section>
  )
}
