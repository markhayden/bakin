'use client'

import type { UsageFeedData } from '../types'
import { formatActivityName } from './activity-row'

const ROW_LIMIT = 8

interface BreakdownRow {
  key: string
  label: string
  count: number
  errors: number
  detail?: string | null
}

function BreakdownPanel({
  title,
  sub,
  rows,
  barColor,
  emptyLabel,
}: {
  title: string
  sub: string
  rows: BreakdownRow[]
  barColor: string
  emptyLabel: string
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
            return (
              <li
                key={row.key}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs"
                data-testid="activity-breakdown-row"
              >
                <span className="min-w-0 truncate text-muted-foreground" title={row.label}>
                  {row.label}
                  {row.detail && <span className="text-muted-foreground/70"> · {row.detail}</span>}
                </span>
                <span className="whitespace-nowrap text-right font-medium tabular-nums text-foreground">
                  {row.count.toLocaleString()}
                  {row.errors > 0 && <span className="text-destructive"> · {row.errors.toLocaleString()} failed</span>}
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                  <span
                    className="relative block h-full overflow-hidden rounded-full"
                    style={{ width: `${width}%`, backgroundColor: barColor }}
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
export function ActivityBreakdown({ data }: { data: UsageFeedData }) {
  const destinations: BreakdownRow[] = data.topByName
    .slice(0, ROW_LIMIT)
    .map((row) => ({
      key: row.name,
      label: formatActivityName(row.name),
      count: row.count,
      errors: row.errors,
      detail: row.medianDurationMs === null ? null : `${row.medianDurationMs.toLocaleString()} ms median`,
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
