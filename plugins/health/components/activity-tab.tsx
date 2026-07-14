'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ActivityBreakdown } from './activity-breakdown'
import { ActivityEventStream } from './activity-event-stream'
import { ActivityFailureGroups } from './activity-failure-groups'
import { ActivityFailureTrend } from './activity-failure-trend'
import { ActivityMetrics } from './activity-metrics'
import { ActivityPulse } from './activity-pulse'
import { ActivityVolumeChart } from './activity-volume-chart'
import { normalizeActivityFeed } from '../lib/activity-feed-compat'
import {
  useActivityData,
  type ActivityKindFilter,
  type ActivityWindow,
} from '../hooks/use-activity-data'

const WINDOWS = new Set<ActivityWindow>(['5m', '1h', '24h'])
const KINDS = new Set<ActivityKindFilter>(['all', 'mcp', 'rest', 'agent'])
const OUTCOMES = new Set<ActivityOutcome>(['all', 'failed'])

type ActivityOutcome = 'all' | 'failed'

const FAILURE_GROUP_PAGE_SIZE = 25

function activityWindow(value: string): ActivityWindow {
  return WINDOWS.has(value as ActivityWindow) ? value as ActivityWindow : '1h'
}

function activityKind(value: string): ActivityKindFilter {
  return KINDS.has(value as ActivityKindFilter) ? value as ActivityKindFilter : 'all'
}

function activityOutcome(value: string): ActivityOutcome {
  return OUTCOMES.has(value as ActivityOutcome) ? value as ActivityOutcome : 'failed'
}

export function ActivityTab() {
  const [windowParam, setWindow] = useQueryState('activity_window', '1h')
  const [kindParam, setKind] = useQueryState('activity_kind', 'all')
  const [routineParam, setRoutine] = useQueryState('include_routine', 'false')
  const [outcomeParam, setOutcome] = useQueryState('activity_outcome', 'failed')
  const window = activityWindow(windowParam)
  const kind = activityKind(kindParam)
  const outcome = activityOutcome(outcomeParam)
  const includeRoutine = outcome === 'all' && routineParam === 'true'
  const failureFilterKey = `${window}:${kind}:${includeRoutine}`
  const [failurePage, setFailurePage] = useState({ key: failureFilterKey, offset: 0 })
  const failureGroupOffset = failurePage.key === failureFilterKey ? failurePage.offset : 0
  const setFailureGroupOffset = (offset: number) => setFailurePage({ key: failureFilterKey, offset })
  const resource = useActivityData({
    window,
    kind,
    includeRoutine,
    ...(failureGroupOffset > 0 ? {
      failureGroupOffset,
      failureGroupLimit: FAILURE_GROUP_PAGE_SIZE,
    } : {}),
  })
  const normalized = normalizeActivityFeed(resource.data, window)
  const data = normalized.data
  const failures = data?.recentFailures ?? []
  const unverified = data?.recentUnverified ?? []
  const totalFailures = data?.outcomes.failed ?? 0
  const totalUnverified = data?.outcomes.unverified ?? 0
  const pageOffset = data?.failureGroupPage?.offset
  const pageLimit = data?.failureGroupPage?.limit
  const pageTotal = data?.failureGroupPage?.total

  useEffect(() => {
    if (pageOffset === undefined || pageLimit === undefined || pageTotal === undefined) return
    if (pageOffset === 0 || pageOffset < pageTotal || pageOffset !== failureGroupOffset) return
    const lastPageOffset = pageTotal === 0 ? 0 : Math.floor((pageTotal - 1) / pageLimit) * pageLimit
    setFailurePage({ key: failureFilterKey, offset: lastPageOffset })
  }, [failureFilterKey, failureGroupOffset, pageLimit, pageOffset, pageTotal])

  return (
    <div className="space-y-5" data-testid="health-activity-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">What is Bakin doing?</h2>
          <p className="text-sm text-muted-foreground">See every tool call, API request, and agent run—then inspect anything that needs attention.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Activity view"
            className="flex w-fit items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5"
          >
            {([
              ['failed', 'Needs attention'],
              ['all', 'All events'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={outcome === value}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${outcome === value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setOutcome(value)}
              >
                {label}
              </button>
            ))}
          </div>
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
              <option value="all">All types</option>
              <option value="mcp">Tools</option>
              <option value="rest">API</option>
              <option value="agent">Agents</option>
            </select>
          </label>
          {outcome === 'all' && (
            <label className="inline-flex h-8 items-center gap-2 rounded-md border border-input px-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={includeRoutine}
                onChange={(event) => setRoutine(event.target.checked ? 'true' : 'false')}
              />
              Include routine success
            </label>
          )}
          <Button size="sm" variant="outline" onClick={() => void resource.refresh()} disabled={resource.refreshing}>
            <RefreshCw className={resource.refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {resource.loading && !data ? (
        <div role="status" aria-label="Loading activity" className="py-16 text-center text-sm text-muted-foreground">
          Loading activity…
        </div>
      ) : resource.error && !data ? (
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

          {data && (
            <ActivityMetrics
              data={data}
              compatibilityLimited={normalized.compatibilityLimited}
              onViewFailures={() => setOutcome('failed')}
            />
          )}

          {data && outcome === 'all' && (
            <ActivityVolumeChart buckets={data.timeBuckets} coverage={data.coverage} />
          )}

          {data && <ActivityPulse data={data} compatibilityLimited={normalized.compatibilityLimited} />}

          {data && outcome === 'all' && <ActivityBreakdown data={data} />}

          {data && totalFailures === 0 && totalUnverified === 0 && (
            <p className="sr-only">
              No failures in this window. {data.totals.count.toLocaleString()} {data.totals.count === 1 ? 'activity was' : 'activities were'} recorded without a failure.
            </p>
          )}

          {data && outcome === 'failed' && (
            <ActivityFailureGroups
              groups={data.failureGroups}
              failures={failures}
              totalFailures={totalFailures}
              unverified={unverified}
              totalUnverified={totalUnverified}
              page={data.failureGroupPage}
              onPageChange={setFailureGroupOffset}
            />
          )}

          {data && outcome === 'failed' && totalFailures > 0 && (
            <section aria-labelledby="activity-failure-trend-title" className="rounded-xl border border-border/80 bg-card p-4">
              <div>
                <h3 id="activity-failure-trend-title" className="font-semibold">Failures over time</h3>
                <p className="text-sm text-muted-foreground">See when failures happened during the selected window.</p>
              </div>
              <div className="mt-3">
                <ActivityFailureTrend buckets={data.timeBuckets} />
              </div>
            </section>
          )}

          {data && outcome === 'all' && <ActivityEventStream data={data} />}
        </>
      )}
    </div>
  )
}
