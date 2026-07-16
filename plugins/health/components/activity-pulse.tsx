'use client'

import { StatusBadge, formatAbsoluteTime } from '@makinbakin/sdk/components'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { InteractionCoverage, UsageFeedData } from '../types'
import { focusActivityElement } from './activity-navigation'
import { INTERACTION_SOURCE_META } from './interaction-source-meta'

const OUTCOMES = [
  { key: 'failed', label: 'failed', color: 'bg-destructive' },
  { key: 'unverified', label: 'unverified', color: 'bg-warning' },
  { key: 'canceled', label: 'canceled', color: 'bg-muted-foreground/55' },
  { key: 'succeeded', label: 'succeeded', color: 'bg-success' },
] as const

const WINDOW_LABEL: Record<UsageFeedData['window'], string> = {
  '5m': '5 minutes',
  '1h': 'hour',
  '24h': '24 hours',
}

function coverageLabel(window: UsageFeedData['window'], coverage: InteractionCoverage): string {
  if (coverage.reason === 'buffer_limit') return 'Partial window · buffer limit'
  if (coverage.reason === 'process_restart') return 'Partial window · since restart'
  return `Full ${WINDOW_LABEL[window]}`
}

function outcomeAriaLabel(data: UsageFeedData): string {
  const { failed, unverified, canceled, succeeded } = data.outcomes
  return `Activity outcomes: ${failed} failed, ${unverified} unverified, ${canceled} canceled, ${succeeded} succeeded`
}

function mixAriaLabel(data: UsageFeedData): string {
  const totals = new Map(data.byKind.map((row) => [row.kind, row.total]))
  return `Activity mix: ${(['mcp', 'rest', 'agent'] as const)
    .map((kind) => `${INTERACTION_SOURCE_META[kind].label} ${totals.get(kind) ?? 0}`)
    .join(', ')}`
}

function coverageStartLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ActivityPulse({
  data,
  compatibilityLimited = false,
}: {
  data: UsageFeedData
  compatibilityLimited?: boolean
}) {
  const hasFailures = data.outcomes.failed > 0
  const hasUnverified = data.outcomes.unverified > 0
  const needsAttention = hasFailures || hasUnverified
  const otherReported = Math.max(0, data.totals.count - data.outcomes.failed)
  const maximumKindTotal = Math.max(1, ...data.byKind.map((row) => row.total))
  const representedKindTotal = data.byKind.reduce((total, row) => total + row.total, 0)

  return (
    <section
      aria-labelledby="activity-pulse-title"
      className="overflow-hidden rounded-xl border border-border/80 bg-border/70"
      data-testid="activity-pulse"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {needsAttention
            ? <AlertCircle className={`size-4 shrink-0 ${hasFailures ? 'text-destructive' : 'text-warning'}`} aria-hidden="true" />
            : <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />}
          <h3 id="activity-pulse-title" className="font-semibold">Activity pulse</h3>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={compatibilityLimited ? 'text-warning' : undefined}>
            {compatibilityLimited ? 'Partial data · restart Bakin for exact metrics' : coverageLabel(data.window, data.coverage)}
          </span>
          <time dateTime={data.coverage.startsAt} title={formatAbsoluteTime(data.coverage.startsAt)}>
            since {coverageStartLabel(data.coverage.startsAt)}
          </time>
        </div>
      </div>

      <div className="grid gap-px @[58rem]/health:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.8fr)]">
        <div className="@container/activity-outcomes min-w-0 bg-card p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {compatibilityLimited ? 'Reported outcomes' : 'How calls ended'}
              </h4>
              <span className="sr-only">
                {data.outcomes.failed.toLocaleString()} of {data.totals.count.toLocaleString()} recorded activities failed.
              </span>
            </div>
            {needsAttention ? (
              <a
                href="#activity-needs-attention"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  const attention = document.getElementById('activity-needs-attention')
                  if (!attention) return
                  event.preventDefault()
                  focusActivityElement(attention)
                }}
              >
                <StatusBadge
                  tone={hasFailures ? 'destructive' : 'warning'}
                  variant="outline"
                  className="cursor-pointer"
                >
                  {hasFailures ? 'Hiccups' : `Verify ${data.outcomes.unverified === 1 ? 'result' : 'results'}`}
                </StatusBadge>
              </a>
            ) : (
              <StatusBadge tone="success" variant="outline">No failures</StatusBadge>
            )}
          </div>

          {!compatibilityLimited && (
            <div className="mt-4" role="group" aria-label={outcomeAriaLabel(data)}>
              <div className="flex h-3 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                {OUTCOMES.map((outcome) => {
                  const count = data.outcomes[outcome.key]
                  return count > 0 ? (
                    <span
                      key={outcome.key}
                      className={outcome.color}
                      style={{ flexBasis: 0, flexGrow: count }}
                    />
                  ) : null
                })}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 @[12rem]/activity-outcomes:grid-cols-2 @[28rem]/activity-outcomes:grid-cols-4">
                {OUTCOMES.map((outcome) => (
                  <div key={outcome.key} className="flex min-w-0 items-center gap-2 text-xs">
                    <span className={`size-2 shrink-0 rounded-full ${outcome.color}`} aria-hidden="true" />
                    <strong className="whitespace-nowrap tabular-nums text-foreground">
                      {data.outcomes[outcome.key].toLocaleString()} {outcome.label}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {compatibilityLimited && (
            <div
              className="mt-4"
              role="group"
              aria-label={`Reported interaction outcomes: ${data.outcomes.failed} failed, ${otherReported} other reported`}
            >
              <div className="flex h-3 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                {data.outcomes.failed > 0 && (
                  <span className="bg-destructive" style={{ flexBasis: 0, flexGrow: data.outcomes.failed }} />
                )}
                {otherReported > 0 && (
                  <span className="bg-muted-foreground/45" style={{ flexBasis: 0, flexGrow: otherReported }} />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-destructive" aria-hidden="true" />
                  <strong className="tabular-nums text-foreground">{data.outcomes.failed.toLocaleString()} failed</strong>
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-muted-foreground/55" aria-hidden="true" />
                  <strong className="tabular-nums text-foreground">{otherReported.toLocaleString()} other reported</strong>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 bg-card p-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {compatibilityLimited ? 'Where recent calls went' : 'Where calls went'}
          </h4>
          {compatibilityLimited && (
            <p className="mt-1 text-xs text-warning">
              Recent breakdown covers {representedKindTotal.toLocaleString()} events.
            </p>
          )}
          <div className="mt-3 space-y-3" role="group" aria-label={mixAriaLabel(data)}>
            {data.byKind.map((row) => {
              const meta = INTERACTION_SOURCE_META[row.kind]
              const Icon = meta.icon
              const width = row.total === 0 ? 0 : Math.max(4, (row.total / maximumKindTotal) * 100)
              const failureWidth = row.total === 0 ? 0 : (row.failures / row.total) * 100
              return (
                <div
                  key={row.kind}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-xs @[24rem]/health:grid-cols-[5rem_minmax(0,1fr)_7rem]"
                  data-source-kind={row.kind}
                >
                  <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <Icon className={`size-3.5 shrink-0 ${meta.iconColorClass}`} aria-hidden="true" />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span
                    className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-foreground/10 @[24rem]/health:col-span-1 @[24rem]/health:col-start-2 @[24rem]/health:row-start-1"
                    aria-hidden="true"
                  >
                    <span
                      className={`relative block h-full overflow-hidden rounded-full ${meta.backgroundClass}`}
                      data-source-bar
                      style={{ width: `${width}%` }}
                    >
                      {row.failures > 0 && (
                        <span className="absolute inset-y-0 right-0 bg-destructive" style={{ width: `${failureWidth}%` }} />
                      )}
                    </span>
                  </span>
                  <strong className="col-start-2 row-start-1 w-28 whitespace-nowrap text-right tabular-nums text-foreground @[24rem]/health:col-start-3">
                    {row.failures > 0
                      ? `${row.failures.toLocaleString()} of ${row.total.toLocaleString()} failed`
                      : row.total.toLocaleString()}
                  </strong>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
