'use client'

import { PieChart, RankedBarChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription } from '@makinbakin/sdk/ui'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { InteractionCoverage, UsageFeedData } from '../types'
import { focusActivityElement } from './activity-navigation'
import { INTERACTION_SOURCE_META } from './interaction-source-meta'
import { Inline } from '@makinbakin/sdk/layout'

const OUTCOMES = [
  { key: 'failed', label: 'failed' },
  { key: 'unverified', label: 'unverified' },
  { key: 'canceled', label: 'canceled' },
  { key: 'succeeded', label: 'succeeded' },
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
  const representedKindTotal = data.byKind.reduce((total, row) => total + row.total, 0)

  const mixData: ChartDatum[] = data.byKind.map((row) => ({
    x: row.kind,
    xLabel: INTERACTION_SOURCE_META[row.kind].label,
    values: { total: row.total, failures: row.failures },
  }))

  return (
    <section
      aria-labelledby="activity-pulse-title"
      className="overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-border-subtle"
      data-testid="activity-pulse"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-2 bg-bakin-surface-default px-bakin-4 py-bakin-3">
        <Inline gap="dense" wrap={false}>
          {needsAttention
            ? <AlertCircle className={`size-bakin-4 shrink-0 ${hasFailures ? 'text-bakin-signal-danger' : 'text-bakin-signal-highlight'}`} aria-hidden="true" />
            : <CheckCircle2 className="size-bakin-4 shrink-0 text-bakin-action-primary-background" aria-hidden="true" />}
          <h3 id="activity-pulse-title">Activity pulse</h3>
        </Inline>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-bakin-2 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
          <span className={compatibilityLimited ? 'text-bakin-signal-highlight' : undefined}>
            {compatibilityLimited ? 'Partial data · restart Bakin for exact metrics' : coverageLabel(data.window, data.coverage)}
          </span>
          <time dateTime={data.coverage.startsAt}>
            since {coverageStartLabel(data.coverage.startsAt)}
          </time>
        </div>
      </div>

      <div className="grid gap-px @[58rem]/health:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.8fr)]">
        <div className="@container/activity-outcomes min-w-0 bg-bakin-surface-default p-bakin-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <div>
              <h4>
                {compatibilityLimited ? 'Reported outcomes' : 'How calls ended'}
              </h4>
              <span className="sr-only">
                {data.outcomes.failed.toLocaleString()} of {data.totals.count.toLocaleString()} recorded activities failed.
              </span>
            </div>
            {needsAttention ? (
              <a
                href="#activity-needs-attention"
                className="rounded-bakin-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bakin-surface-default"
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  const attention = document.getElementById('activity-needs-attention')
                  if (!attention) return
                  event.preventDefault()
                  focusActivityElement(attention)
                }}
              >
                <StatusBadge
                  tone={hasFailures ? 'danger' : 'attention'}
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
            <div className="mt-bakin-4" role="group" aria-label={outcomeAriaLabel(data)}>
              <PieChart
                donut
                data={OUTCOMES.map((outcome) => ({
                  key: outcome.key,
                  label: outcome.label,
                  value: data.outcomes[outcome.key],
                }))}
                tones={{ succeeded: 'success', failed: 'danger', unverified: 'attention', canceled: 'neutral' }}
                label="How calls ended"
                formatValue={(value) => value.toLocaleString()}
                emptyLabel="No recorded outcomes in this window."
              />
            </div>
          )}

          {compatibilityLimited && (
            <div
              className="mt-bakin-4"
              role="group"
              aria-label={`Reported interaction outcomes: ${data.outcomes.failed} failed, ${otherReported} other reported`}
            >
              <PieChart
                donut
                data={[
                  { key: 'failed', label: 'failed', value: data.outcomes.failed },
                  { key: 'other', label: 'other reported', value: otherReported },
                ]}
                tones={{ failed: 'danger', other: 'neutral' }}
                label="Reported interaction outcomes"
                formatValue={(value) => value.toLocaleString()}
                emptyLabel="No reported outcomes in this window."
              />
            </div>
          )}
        </div>

        <div className="min-w-0 bg-bakin-surface-default p-bakin-4">
          <h4>
            {compatibilityLimited ? 'Where recent calls went' : 'Where calls went'}
          </h4>
          {compatibilityLimited && (
            <Alert tone="attention" className="mt-bakin-1">
              <AlertDescription>
                Recent breakdown covers {representedKindTotal.toLocaleString()} events.
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-bakin-3" role="group" aria-label={mixAriaLabel(data)}>
            <RankedBarChart
              data={mixData}
              series={{ key: 'total', label: 'calls' }}
              secondary={{ key: 'failures', label: 'failed' }}
              tones={{ failures: 'danger' }}
              label={compatibilityLimited ? 'Where recent calls went' : 'Where calls went'}
              formatValue={(value) => value.toLocaleString()}
              compactData
            />
          </div>
        </div>
      </div>
    </section>
  )
}
