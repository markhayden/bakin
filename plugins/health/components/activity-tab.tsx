'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { AlertCircle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'
import { ActivityFailureTrend } from './activity-failure-trend'
import { ActivityRow, isCanceledActivity, isUnverifiedActivity } from './activity-row'
import {
  useActivityData,
  type ActivityKindFilter,
  type ActivityWindow,
} from '../hooks/use-activity-data'

const WINDOWS = new Set<ActivityWindow>(['5m', '1h', '24h'])
const KINDS = new Set<ActivityKindFilter>(['all', 'mcp', 'rest', 'agent'])

function activityWindow(value: string): ActivityWindow {
  return WINDOWS.has(value as ActivityWindow) ? value as ActivityWindow : '1h'
}

function activityKind(value: string): ActivityKindFilter {
  return KINDS.has(value as ActivityKindFilter) ? value as ActivityKindFilter : 'all'
}

export function ActivityTab() {
  const [windowParam, setWindow] = useQueryState('activity_window', '1h')
  const [kindParam, setKind] = useQueryState('activity_kind', 'all')
  const [routineParam, setRoutine] = useQueryState('include_routine', 'false')
  const window = activityWindow(windowParam)
  const kind = activityKind(kindParam)
  const includeRoutine = routineParam === 'true'
  const resource = useActivityData({ window, kind, includeRoutine })
  const failures = resource.data?.recentFailures ?? []
  const aborted = resource.data?.recent.filter(isCanceledActivity) ?? []
  const unverified = resource.data?.recentUnverified ?? []
  const successes = resource.data?.recent.filter((entry) => (
    entry.status === 'ok' && !isCanceledActivity(entry) && !isUnverifiedActivity(entry)
  )) ?? []
  const totalActivity = resource.data?.totals.count ?? 0
  const totalFailures = resource.data?.totals.errors ?? 0
  const hasFailures = totalFailures > 0
  const failureHeading = totalFailures > failures.length
    ? `Failures (showing ${failures.length.toLocaleString()} of ${totalFailures.toLocaleString()})`
    : `Failures (${failures.length.toLocaleString()})`

  return (
    <div className="space-y-5" data-testid="health-activity-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">What failed recently?</h2>
          <p className="text-sm text-muted-foreground">Start here when a tool, request, or agent did not work.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">
            <span className="sr-only">Activity window</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
              value={window}
              onChange={(event) => setWindow(event.target.value)}
            >
              <option value="5m">Last 5 minutes</option>
              <option value="1h">Last hour</option>
              <option value="24h">Last 24 hours</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="sr-only">Activity kind</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">All activity</option>
              <option value="mcp">Tools</option>
              <option value="rest">Requests</option>
              <option value="agent">Agents</option>
            </select>
          </label>
          <label className="inline-flex h-8 items-center gap-2 rounded-md border border-input px-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={includeRoutine}
              onChange={(event) => setRoutine(event.target.checked ? 'true' : 'false')}
            />
            Include routine success
          </label>
          <Button size="sm" variant="outline" onClick={() => void resource.refresh()} disabled={resource.refreshing}>
            <RefreshCw className={resource.refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {resource.loading && !resource.data ? (
        <div role="status" aria-label="Loading activity" className="py-16 text-center text-sm text-muted-foreground">
          Loading activity…
        </div>
      ) : resource.error && !resource.data ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <h3 className="font-medium text-destructive">Activity could not be loaded.</h3>
          <p className="mt-1 text-sm text-muted-foreground">{resource.error}</p>
          <Button className="mt-4" size="sm" variant="outline" onClick={() => void resource.refresh()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {resource.backgroundError && (
            <p role="status" className="text-xs text-warning">
              Showing the last loaded activity; refresh failed: {resource.backgroundError}
            </p>
          )}

          <section
            aria-labelledby="activity-decision-title"
            className={`rounded-xl border p-4 ${hasFailures ? 'border-destructive/30 bg-destructive/5' : 'border-success/25 bg-success/5'}`}
          >
            <div className="flex items-start gap-3">
              {hasFailures
                ? <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />}
              <div>
                <h3 id="activity-decision-title" className="font-semibold">
                  {hasFailures
                    ? `${totalFailures.toLocaleString()} of ${totalActivity.toLocaleString()} recorded activities failed.`
                    : 'No failures in this window.'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasFailures
                    ? 'Review the failures below. Repeated failures may point to a health issue.'
                    : `${totalActivity.toLocaleString()} ${totalActivity === 1 ? 'activity was' : 'activities were'} recorded without a failure.`}
                </p>
              </div>
            </div>
          </section>

          {failures.length > 0 && (
            <section aria-labelledby="activity-failures-title" className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
                <h3 id="activity-failures-title" className="font-semibold">{failureHeading}</h3>
              </div>
              <ul className="space-y-2">{failures.map((entry, index) => (
                <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
              ))}</ul>
            </section>
          )}

          {hasFailures && (
            <section aria-labelledby="activity-failure-trend-title" className="space-y-3">
              <div>
                <h3 id="activity-failure-trend-title" className="font-semibold">Failures over time</h3>
                <p className="text-sm text-muted-foreground">See when failures happened during the selected window.</p>
              </div>
              <ActivityFailureTrend buckets={resource.data?.timeBuckets ?? []} />
            </section>
          )}

          {aborted.length > 0 && (
            <details className="group rounded-xl border border-border/70 bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Canceled activity ({aborted.length})
              </summary>
              <div className="border-t border-border/70 p-4">
                <p className="mb-3 text-sm text-muted-foreground">Canceled work is recorded for context, but it does not count as a failure.</p>
                <ul className="space-y-2">{aborted.map((entry, index) => (
                  <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
                ))}</ul>
              </div>
            </details>
          )}

          {unverified.length > 0 && (
            <details className="group rounded-xl border border-border/70 bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Result not observed ({unverified.length})
              </summary>
              <div className="border-t border-border/70 p-4">
                <p className="mb-3 text-sm text-muted-foreground">The owning turn ended without a final tool-result event. This is recorded as incomplete telemetry, not as success or failure.</p>
                <ul className="space-y-2">{unverified.map((entry, index) => (
                  <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
                ))}</ul>
              </div>
            </details>
          )}

          {successes.length > 0 && (
            <details className="group rounded-xl border border-border/70 bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Successful activity ({successes.length})
              </summary>
              <div className="border-t border-border/70 p-4">
                <p className="mb-3 text-sm text-muted-foreground">Open this when you want to confirm that a retry or recent action worked.</p>
                <ul className="space-y-2">{successes.map((entry, index) => (
                  <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
                ))}</ul>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
