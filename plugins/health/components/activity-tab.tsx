'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@makinbakin/sdk/ui'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { ActivityFailureTrend } from './activity-failure-trend'
import { ActivityRow } from './activity-row'
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
  const failures = resource.data?.recent.filter((entry) => entry.status === 'error') ?? []
  const successes = resource.data?.recent.filter((entry) => entry.status === 'ok') ?? []

  return (
    <div className="space-y-5" data-testid="health-activity-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-sm text-muted-foreground">Failures lead. Routine success stays hidden unless you ask for it.</p>
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

          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Activity</p><p className="mt-1 text-2xl font-semibold tabular-nums">{resource.data?.totals.count ?? 0}</p></CardContent></Card>
            <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failures</p><p className="mt-1 text-2xl font-semibold tabular-nums text-destructive">{resource.data?.totals.errors ?? 0}</p></CardContent></Card>
            <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failure rate</p><p className="mt-1 text-2xl font-semibold tabular-nums">{((resource.data?.totals.errorRate ?? 0) * 100).toFixed(1)}%</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base"><h3>Failure trend</h3></CardTitle></CardHeader>
            <CardContent>
              <ActivityFailureTrend buckets={resource.data?.timeBuckets ?? []} />
            </CardContent>
          </Card>

          <section aria-labelledby="activity-failures-title" className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
              <h3 id="activity-failures-title" className="font-semibold">Failures ({failures.length})</h3>
            </div>
            {failures.length > 0
              ? <ul className="space-y-2">{failures.map((entry) => <ActivityRow key={`${entry.ts}:${entry.kind}:${entry.name}`} entry={entry} />)}</ul>
              : <p className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">No failures in this window.</p>}
          </section>

          <section aria-labelledby="activity-recent-title" className="space-y-3">
            <h3 id="activity-recent-title" className="font-semibold">Recent successful activity ({successes.length})</h3>
            {successes.length > 0
              ? <ul className="space-y-2">{successes.map((entry) => <ActivityRow key={`${entry.ts}:${entry.kind}:${entry.name}`} entry={entry} />)}</ul>
              : <p className="text-sm text-muted-foreground">No successful activity matches these filters.</p>}
          </section>
        </>
      )}
    </div>
  )
}
