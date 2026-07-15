'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ActivityBreakdown, type ActivityFailureSelection } from './activity-breakdown'
import { ActivityEventStream } from './activity-event-stream'
import {
  ActivityFailureGroups,
  FAILURE_PATTERN_PREVIEW_LIMIT,
  type ActivityFailurePageChangeOptions,
  type ActivityFailureRequest,
} from './activity-failure-groups'
import { ActivityMetrics } from './activity-metrics'
import { focusActivityElement } from './activity-navigation'
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
const FILTER_SELECT_CLASS = 'h-8 appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-foreground'

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
  const [failureRequest, setFailureRequest] = useState<(ActivityFailureRequest & { filterKey: string }) | null>(null)
  const [failureTarget, setFailureTarget] = useState<({
    filterKey: string
    kind: Exclude<ActivityFailureSelection['kind'], undefined>
    method: string | null
    destination: string
  }) | null>(null)
  const failureRequestId = useRef(0)
  const failurePageFocusId = useRef(0)
  const [failurePageRestore, setFailurePageRestore] = useState<{
    filterKey: string
    offset: number
    requestId: number
    expanded: boolean
    focusTarget: ActivityFailurePageChangeOptions['focusTarget']
  } | null>(null)
  const pendingDisclosureFocus = useRef<{ sawLoading: boolean } | null>(null)
  const attentionHashWasInitial = useRef(
    typeof document !== 'undefined' && document.location.hash === '#activity-needs-attention',
  )
  const handledAttentionHash = useRef(false)
  const failureGroupOffset = failurePage.key === failureFilterKey ? failurePage.offset : 0
  const activeFailureTarget = failureTarget?.filterKey === failureFilterKey ? failureTarget : null
  const setFailureGroupOffset = (
    offset: number,
    options: ActivityFailurePageChangeOptions = { expanded: true, focusTarget: 'first-pattern' },
  ) => {
    setFailureTarget(null)
    setFailureRequest(null)
    setFailurePage({ key: failureFilterKey, offset })
    failurePageFocusId.current += 1
    setFailurePageRestore({
      filterKey: failureFilterKey,
      offset,
      requestId: failurePageFocusId.current,
      expanded: options.expanded,
      focusTarget: options.focusTarget,
    })
  }
  const resource = useActivityData({
    window,
    kind,
    includeRoutine: true,
    ...(activeFailureTarget ? {
      exactFailureTargetingSupported: true,
      failureGroupTarget: {
        kind: activeFailureTarget.kind,
        method: activeFailureTarget.method,
        destination: activeFailureTarget.destination,
      },
    } : failureGroupOffset > 0 ? {
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
  const failurePageRestoreReady = failurePageRestore?.filterKey === failureFilterKey
    && pageOffset === failurePageRestore.offset

  const reviewFailures = (selection: ActivityFailureSelection) => {
    pendingDisclosureFocus.current = null
    const exactTarget = data?.capabilities?.exactFailureTargeting === true
      && selection.kind !== undefined
      && selection.method !== undefined
      ? {
          filterKey: failureFilterKey,
          kind: selection.kind,
          method: selection.method,
          destination: selection.destination,
        }
      : null
    failureRequestId.current += 1
    setFailurePageRestore(null)
    setFailurePage({ key: failureFilterKey, offset: 0 })
    setFailureTarget(exactTarget)
    setFailureRequest({
      ...selection,
      filterKey: failureFilterKey,
      requestId: failureRequestId.current,
    })
  }

  const changeWindow = (nextValue: string) => {
    pendingDisclosureFocus.current = null
    setFailureTarget(null)
    setFailureRequest(null)
    setFailurePageRestore(null)
    setFailurePage({ key: `${activityWindow(nextValue)}:${kind}`, offset: 0 })
    setWindow(nextValue)
  }

  const changeKind = (nextValue: string) => {
    pendingDisclosureFocus.current = null
    setFailureTarget(null)
    setFailureRequest(null)
    setFailurePageRestore(null)
    setFailurePage({ key: `${window}:${activityKind(nextValue)}`, offset: 0 })
    setKind(nextValue)
  }

  useEffect(() => {
    setFailureTarget((current) => current?.filterKey === failureFilterKey ? current : null)
    setFailureRequest((current) => current?.filterKey === failureFilterKey ? current : null)
  }, [failureFilterKey])

  useEffect(() => {
    if (pageOffset === undefined || pageLimit === undefined || pageTotal === undefined) return
    if (pageOffset === 0 || pageOffset < pageTotal || pageOffset !== failureGroupOffset) return
    const lastPageOffset = pageTotal === 0 ? 0 : Math.floor((pageTotal - 1) / pageLimit) * pageLimit
    setFailurePage({ key: failureFilterKey, offset: lastPageOffset })
  }, [failureFilterKey, failureGroupOffset, pageLimit, pageOffset, pageTotal])

  useEffect(() => {
    const pending = pendingDisclosureFocus.current
    if (!pending) return
    if (resource.loading || !data) {
      pending.sawLoading = true
      return
    }
    if (!pending.sawLoading) return
    const disclosure = document.getElementById('activity-failure-pattern-disclosure')
    if (!disclosure) return
    focusActivityElement(disclosure, { block: 'center' })
    pendingDisclosureFocus.current = null
  }, [data, resource.loading])

  useEffect(() => {
    if (!failurePageRestoreReady) return
    if (failurePageRestore?.focusTarget === 'disclosure') {
      const disclosure = document.getElementById('activity-failure-pattern-disclosure')
      if (!disclosure) return
      focusActivityElement(disclosure, { block: 'center' })
    }
    setFailurePageRestore((current) => current?.requestId === failurePageRestore?.requestId ? null : current)
  }, [failurePageRestore?.focusTarget, failurePageRestore?.requestId, failurePageRestoreReady])

  useEffect(() => {
    if (!attentionHashWasInitial.current || !data || handledAttentionHash.current) return
    if (document.location.hash !== '#activity-needs-attention') return
    const attention = document.getElementById('activity-needs-attention')
    if (!attention) return
    handledAttentionHash.current = true
    focusActivityElement(attention)
  }, [data])

  return (
    <div className="space-y-5" data-testid="health-activity-tab">
      <HealthTabIntro
        title="Activity"
        description="Review recorded tool calls, API requests, and agent runs across Bakin. Routine successes stay visible, with failures called out for inspection."
        actions={(
          <>
            <label className="relative inline-flex text-xs text-muted-foreground">
              <span className="sr-only">Activity window</span>
              <select
                className={FILTER_SELECT_CLASS}
                value={window}
                onChange={(event) => changeWindow(event.target.value)}
              >
                <option value="5m">Last 5 minutes</option>
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
              </select>
              <ChevronDown
                data-activity-filter-chevron
                className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </label>
            <label className="relative inline-flex text-xs text-muted-foreground">
              <span className="sr-only">Activity kind</span>
              <select
                className={FILTER_SELECT_CLASS}
                value={kind}
                onChange={(event) => changeKind(event.target.value)}
              >
                <option value="all">All types</option>
                <option value="mcp">Tools</option>
                <option value="rest">API</option>
                <option value="agent">Agents</option>
              </select>
              <ChevronDown
                data-activity-filter-chevron
                className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
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
              key={`${failureFilterKey}:${(data.failureGroupPage?.total ?? data.failureGroups.length) > FAILURE_PATTERN_PREVIEW_LIMIT ? 'has-remainder' : 'complete'}`}
              groups={data.failureGroups}
              failures={failures}
              totalFailures={totalFailures}
              unverified={unverified}
              totalUnverified={totalUnverified}
              buckets={data.timeBuckets}
              coverage={data.coverage}
              page={data.failureGroupPage}
              onPageChange={setFailureGroupOffset}
              initiallyExpanded={failurePageRestoreReady && failurePageRestore?.expanded === true}
              pageFocusRequestId={failurePageRestoreReady && failurePageRestore?.focusTarget === 'first-pattern'
                ? failurePageRestore.requestId
                : undefined}
              onDetailsExpandedChange={(expanded) => {
                if (expanded) return
                if (activeFailureTarget) {
                  pendingDisclosureFocus.current = { sawLoading: false }
                } else setFailurePageRestore(null)
                setFailureTarget(null)
                setFailureRequest(null)
              }}
              failureRequest={failureRequest?.filterKey === failureFilterKey ? failureRequest : null}
            />
          )}

          {data && <ActivityVolumeChart buckets={data.timeBuckets} coverage={data.coverage} />}

          {data && <ActivityBreakdown data={data} onReviewFailures={reviewFailures} />}

          {data && <ActivityEventStream data={data} />}
        </>
      )}
    </div>
  )
}
