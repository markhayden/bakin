'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ActivityBreakdown } from './activity-breakdown'
import { ActivityEventStream } from './activity-event-stream'
import { ActivityFailureGroups, FAILURE_PATTERN_PREVIEW_LIMIT } from './activity-failure-groups'
import { ActivityFailureTrend } from './activity-failure-trend'
import { ActivityMetrics } from './activity-metrics'
import { ActivityPulse } from './activity-pulse'
import { ActivityVolumeChart } from './activity-volume-chart'
import { HealthTabIntro } from './health-tab-intro'
import { normalizeActivityFeed } from '../lib/activity-feed-compat'
import {
  useActivityData,
  type ActivityKindFilter,
  type ActivityWindow,
} from '../hooks/use-activity-data'

const WINDOWS = new Set<ActivityWindow>(['5m', '1h', '24h'])
const KINDS = new Set<ActivityKindFilter>(['all', 'mcp', 'rest', 'agent'])

const FAILURE_GROUP_PAGE_SIZE = 25

function activityWindow(value: string): ActivityWindow {
  return WINDOWS.has(value as ActivityWindow) ? value as ActivityWindow : '1h'
}

function activityKind(value: string): ActivityKindFilter {
  return KINDS.has(value as ActivityKindFilter) ? value as ActivityKindFilter : 'all'
}

export function ActivityTab() {
  const [windowParam, setWindow] = useQueryState('activity_window', '1h')
  const [kindParam, setKind] = useQueryState('activity_kind', 'all')
  const window = activityWindow(windowParam)
  const kind = activityKind(kindParam)
  const failureFilterKey = `${window}:${kind}`
  const [failurePage, setFailurePage] = useState({ key: failureFilterKey, offset: 0 })
  const handledAttentionHash = useRef(false)
  const failureGroupOffset = failurePage.key === failureFilterKey ? failurePage.offset : 0
  const setFailureGroupOffset = (offset: number) => setFailurePage({ key: failureFilterKey, offset })
  const resource = useActivityData({
    window,
    kind,
    includeRoutine: true,
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

  useEffect(() => {
    if (!data || handledAttentionHash.current) return
    if (document.location.hash !== '#activity-needs-attention') return
    const attention = document.getElementById('activity-needs-attention')
    if (!attention) return
    handledAttentionHash.current = true
    attention.scrollIntoView({ block: 'start' })
    attention.focus({ preventScroll: true })
  }, [data])

  return (
    <div className="space-y-5" data-testid="health-activity-tab">
      <HealthTabIntro
        title="Activity"
        description="Review every tool call, API request, and agent run across Bakin. Routine successes stay visible, with failures called out for inspection."
        actions={(
          <>
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
            <Button size="sm" variant="outline" onClick={() => void resource.refresh()} disabled={resource.refreshing}>
              <RefreshCw className={resource.refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
              Refresh
            </Button>
          </>
        )}
      />

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
            />
          )}

          {data && <ActivityPulse data={data} compatibilityLimited={normalized.compatibilityLimited} />}

          {data && totalFailures === 0 && totalUnverified === 0 && (
            <p className="sr-only">
              No failures in this window. {data.totals.count.toLocaleString()} {data.totals.count === 1 ? 'activity was' : 'activities were'} recorded without a failure.
            </p>
          )}

          {data && (
            <ActivityFailureGroups
              key={`${failureFilterKey}:${failureGroupOffset}:${data.failureGroups.length > FAILURE_PATTERN_PREVIEW_LIMIT ? 'has-remainder' : 'complete'}`}
              groups={data.failureGroups}
              failures={failures}
              totalFailures={totalFailures}
              unverified={unverified}
              totalUnverified={totalUnverified}
              page={data.failureGroupPage}
              onPageChange={setFailureGroupOffset}
            />
          )}

          {data && totalFailures > 0 && (
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

          {data && <ActivityVolumeChart buckets={data.timeBuckets} coverage={data.coverage} />}

          {data && <ActivityBreakdown data={data} />}

          {data && <ActivityEventStream data={data} />}
        </>
      )}
    </div>
  )
}
