'use client'

import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { Grid, Panel, Section } from '@makinbakin/sdk/layout'
import { ListRows, Pagination, StatusBadge } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InteractionCoverage, UsageEntry, UsageFailureGroup, UsageFailureGroupPage, UsageFeedData } from '../types'
import type { ActivityFailureSelection } from './activity-breakdown'
import { ActivityFailureTrend } from './activity-failure-trend'
import { focusActivityElement } from './activity-navigation'
import { ActivityRow, activityFailureReason, formatActivityName } from './activity-row'
import { INTERACTION_SOURCE_META } from './interaction-source-meta'

export const FAILURE_PATTERN_PREVIEW_LIMIT = 3

export interface ActivityFailureRequest extends ActivityFailureSelection {
  requestId: number
}

export interface ActivityFailurePageChangeOptions {
  expanded: boolean
  focusTarget: 'first-pattern' | 'disclosure'
}

function entryDestination(entry: UsageEntry): string {
  const routePattern = entry.kind === 'rest' ? entry.meta?.routePattern : undefined
  return typeof routePattern === 'string' && routePattern.length > 0 ? routePattern : entry.name
}

function entryMethod(entry: UsageEntry): string | null {
  if (entry.kind !== 'rest') return null
  const method = entry.meta?.method
  return typeof method === 'string' && method.trim().length > 0 ? method.trim().toUpperCase() : null
}

function matchingFailures(group: UsageFailureGroup, failures: UsageEntry[]): UsageEntry[] {
  const destination = group.destination ?? group.name
  const candidates = [
    ...failures.filter((entry) => (
      entry.kind === group.kind
      && entryDestination(entry) === destination
      && (group.method === undefined || entryMethod(entry) === group.method)
    )),
    ...(group.latestFailure ? [group.latestFailure] : []),
  ]
  const seen = new Set<string>()
  return candidates
    .filter((entry) => {
      const key = entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${entry.agent ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => right.ts.localeCompare(left.ts))
}

function failureCountLabel(group: UsageFailureGroup): string {
  const failures = `${group.failures.toLocaleString()} ${group.failures === 1 ? 'failure' : 'failures'}`
  const attempts = `${group.attempts.toLocaleString()} ${group.attempts === 1 ? 'attempt' : 'attempts'}`
  return `${failures} in ${attempts}`
}

function failureGroupDisplayName(group: UsageFailureGroup): string {
  const destination = group.destination ?? group.name
  return `${group.method ? `${group.method} ` : ''}${formatActivityName(destination)}`
}

function failureGroupKey(group: UsageFailureGroup): string {
  return JSON.stringify([group.kind, group.method ?? null, group.destination ?? group.name])
}

function failureGroupElementId(group: UsageFailureGroup): string {
  return `activity-failure-pattern-${encodeURIComponent(failureGroupKey(group))}`
}

function matchesFailureRequest(group: UsageFailureGroup, request: ActivityFailureRequest): boolean {
  if (request.kind === undefined || request.method === undefined) return false
  return group.kind === request.kind
    && (group.destination ?? group.name) === request.destination
    && (group.method ?? null) === request.method
}

function showEventButtonLabel(visible: number, total: number): string {
  if (visible === total) return `View ${visible.toLocaleString()} failure ${visible === 1 ? 'event' : 'events'}`
  return `View ${visible.toLocaleString()} of ${total.toLocaleString()} recent failure events`
}

function hideEventButtonLabel(visible: number): string {
  return `Hide ${visible.toLocaleString()} failure ${visible === 1 ? 'event' : 'events'}`
}

function relativeFailureTime(value: string): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return 'just now'
  return /^\d+[mhd]$/.test(relative) ? `${relative} ago` : relative
}

function failureAgents(group: UsageFailureGroup): string {
  const known = group.agents.join(', ')
  const system = group.systemFailures > 0
    ? group.systemFailures === 1
      ? 'Bakin system'
      : `Bakin system (${group.systemFailures.toLocaleString()})`
    : ''
  const unattributed = group.unattributedFailures > 0
    ? group.unattributedFailures === 1
      ? 'Agent not recorded'
      : `Agent not recorded (${group.unattributedFailures.toLocaleString()})`
    : ''
  return [known, system, unattributed].filter(Boolean).join(' · ') || 'Agent not recorded'
}

function FailureGroup({
  group,
  failures,
  selected = false,
}: {
  group: UsageFailureGroup
  failures: UsageEntry[]
  selected?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = INTERACTION_SOURCE_META[group.kind]
  const Icon = meta.icon
  const destination = group.destination ?? group.name
  const displayName = failureGroupDisplayName(group)
  const label = `${meta.label} · ${displayName}`
  const events = matchingFailures(group, failures)
  const latest = group.latestFailure ?? events[0]
  const reason = latest ? activityFailureReason(latest) : 'No failure reason was reported.'
  const relative = relativeFailureTime(group.lastFailureAt)
  const agents = failureAgents(group)
  const disclosureId = `activity-failure-events-${group.kind}-${group.method ?? 'none'}-${encodeURIComponent(destination)}`
  const disclosureLabel = expanded
    ? hideEventButtonLabel(events.length)
    : showEventButtonLabel(events.length, group.failures)

  return (
    <div
      id={failureGroupElementId(group)}
      role="group"
      aria-label={label}
      className={`min-w-0 border-b border-bakin-border-subtle outline-none last:border-b-0 ${selected ? 'border-l-2 border-l-bakin-signal-danger bg-bakin-surface-default' : ''} focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bakin-focus-ring`}
      data-selected={selected ? 'true' : undefined}
      tabIndex={-1}
    >
      <div className="grid min-w-0 gap-bakin-3 px-bakin-3 py-bakin-4 @[38rem]/health:grid-cols-[minmax(0,1fr)_auto] @[38rem]/health:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <Icon className="size-bakin-4 shrink-0" aria-hidden="true" />
            <h4 className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
              {displayName}
            </h4>
            <span className="text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
              {meta.label}
            </span>
          </div>

          <p className="mt-bakin-2 truncate text-bakin-typography-size-body text-bakin-text-primary">{reason}</p>
          <div className="mt-bakin-2 flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
            <StatusBadge tone="danger" variant="solid">{failureCountLabel(group)}</StatusBadge>
            <span className="min-w-0 truncate">
              {agents}
            </span>
            <span>
              Last failed{' '}
              <time dateTime={group.lastFailureAt}>
                {relative}
              </time>
            </span>
          </div>
        </div>

        <Button
          size="xs"
          variant="outline"
          aria-label={`${disclosureLabel} for ${label}`}
          aria-expanded={expanded}
          aria-controls={disclosureId}
          onClick={() => setExpanded((value) => !value)}
          disabled={events.length === 0}
        >
          {disclosureLabel}
          <ChevronDown
            className={expanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'}
            aria-hidden="true"
          />
        </Button>
      </div>

      {expanded && (
        <div
          id={disclosureId}
          className="border-t border-bakin-border-subtle bg-bakin-surface-default px-bakin-3 py-bakin-3"
        >
          {events.length < group.failures && (
            <p className="mb-bakin-3 text-bakin-typography-size-meta text-bakin-text-muted">
              Showing the {events.length.toLocaleString()} most recent of {group.failures.toLocaleString()} failures in this window.
            </p>
          )}
          <ListRows aria-label={`Failure events for ${label}`}>
            {events.map((entry, index) => (
              <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
            ))}
          </ListRows>
        </div>
      )}
    </div>
  )
}

function FailurePatternHighlights({
  groups,
  page,
}: {
  groups: UsageFailureGroup[]
  page?: UsageFailureGroupPage
}) {
  const highlights = groups.slice(0, FAILURE_PATTERN_PREVIEW_LIMIT)
  const pageLocal = (page?.offset ?? 0) > 0
  const label = pageLocal ? 'Failure patterns on this page' : 'Top failure patterns'

  return (
    <div className="min-w-0">
      <h4 className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
        {label}
      </h4>
      {highlights.length > 0 ? (
        <ol className="mt-bakin-2 divide-y divide-bakin-border-subtle" aria-label={label}>
          {highlights.map((group) => {
            const meta = INTERACTION_SOURCE_META[group.kind]
            const Icon = meta.icon
            const destination = group.destination ?? group.name
            const latest = group.latestFailure
            const reason = latest ? activityFailureReason(latest) : 'No failure reason was reported.'
            return (
              <li
                key={`${group.kind}:${group.method ?? ''}:${destination}`}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-bakin-3 py-bakin-2 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-bakin-2">
                  <Icon className={`size-bakin-3 shrink-0 `} aria-hidden="true" />
                  <span className="min-w-0">
                    <strong className="block truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
                      {failureGroupDisplayName(group)}
                    </strong>
                    <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">
                      <span>{meta.label} · </span>
                      <span>{reason}</span>
                    </span>
                  </span>
                </span>
                <strong className="whitespace-nowrap text-right text-bakin-typography-size-meta font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary">
                  {failureCountLabel(group)}
                </strong>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-bakin-2 text-bakin-typography-size-body text-bakin-text-muted">Refreshing failure patterns…</p>
      )}
    </div>
  )
}

function ResultsToVerify({
  unverified,
  totalUnverified,
}: {
  unverified: UsageEntry[]
  totalUnverified: number
}) {
  if (totalUnverified === 0) return null

  return (
    <div className="space-y-bakin-2">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-bakin-2">
        <div>
          <h4 className="font-bakin-typography-weight-semibold text-bakin-text-primary">Results to verify</h4>
          <p className="mt-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">
            Confirm whether these calls completed before retrying them.
          </p>
        </div>
        {unverified.length < totalUnverified && (
          <span className="text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
            Showing {unverified.length.toLocaleString()} of {totalUnverified.toLocaleString()}
          </span>
        )}
      </div>
      {unverified.length > 0 ? (
        <ListRows aria-label="Results to verify">
          {unverified.map((entry, index) => (
            <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
          ))}
        </ListRows>
      ) : (
        <p className="border-l-2 border-bakin-signal-highlight bg-bakin-surface-default px-bakin-4 py-bakin-3 text-bakin-typography-size-body text-bakin-text-muted">
          No recent raw evidence is available for these result gaps.
        </p>
      )}
    </div>
  )
}

export function ActivityFailureGroups({
  groups,
  failures,
  totalFailures,
  unverified,
  totalUnverified,
  buckets,
  coverage,
  page,
  onPageChange,
  initiallyExpanded = false,
  pageFocusRequestId,
  onDetailsExpandedChange,
  failureRequest,
}: {
  groups: UsageFailureGroup[]
  failures: UsageEntry[]
  totalFailures: number
  unverified: UsageEntry[]
  totalUnverified: number
  buckets: UsageFeedData['timeBuckets']
  coverage: InteractionCoverage
  page?: UsageFailureGroupPage
  onPageChange?: (offset: number, options?: ActivityFailurePageChangeOptions) => void
  initiallyExpanded?: boolean
  pageFocusRequestId?: number
  onDetailsExpandedChange?: (expanded: boolean) => void
  failureRequest?: ActivityFailureRequest | null
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(initiallyExpanded)
  const patternTotal = page?.total ?? groups.length
  const hasPatterns = groups.length > 0
  const patternStart = groups.length > 0 ? (page?.offset ?? 0) + 1 : 0
  const patternEnd = groups.length > 0 ? (page?.offset ?? 0) + groups.length : 0
  const showPaging = page !== undefined && (page.offset > 0 || page.hasMore)
  const reviewLabel = page && patternTotal > groups.length
    ? `Review failure patterns ${patternStart.toLocaleString()}–${patternEnd.toLocaleString()} of ${patternTotal.toLocaleString()}`
    : `Review all ${patternTotal.toLocaleString()} failure ${patternTotal === 1 ? 'pattern' : 'patterns'}`
  const description = totalFailures > 0
    ? totalUnverified > 0
      ? 'Repeated failures are grouped. Calls missing a final result are listed separately.'
      : 'Repeated failures are grouped so the biggest patterns stand out first.'
    : 'These calls ended without a final result event, so Bakin cannot confirm their outcome.'
  const matchingGroup = failureRequest
    ? groups.find((group) => matchesFailureRequest(group, failureRequest))
    : undefined
  const matchingGroupElementId = matchingGroup ? failureGroupElementId(matchingGroup) : null
  const requestId = failureRequest?.requestId

  useEffect(() => {
    if (requestId === undefined) return
    setDetailsExpanded(true)
  }, [requestId])

  useEffect(() => {
    if (requestId === undefined || !detailsExpanded) return
    const target = matchingGroupElementId
      ? document.getElementById(matchingGroupElementId)
      : document.getElementById('activity-needs-attention')
    if (!target) return
    focusActivityElement(target, { block: matchingGroupElementId ? 'center' : 'start' })
  }, [detailsExpanded, matchingGroupElementId, requestId])

  useEffect(() => {
    if (pageFocusRequestId === undefined || !detailsExpanded) return
    const firstGroup = groups[0]
    if (!firstGroup) return
    const target = document.getElementById(failureGroupElementId(firstGroup))
    if (!target) return
    focusActivityElement(target, { block: 'center' })
  }, [detailsExpanded, groups, pageFocusRequestId])

  if (totalFailures === 0 && totalUnverified === 0) return null

  return (
    <Section
      id="activity-needs-attention"
      aria-labelledby="activity-needs-attention-title"
      divider="top"
      spacing="compact"
      className="scroll-mt-bakin-4 outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
      tabIndex={-1}
    >
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-bakin-2">
        <div>
          <div className="flex items-center gap-bakin-2">
            <AlertCircle className={`size-bakin-4 ${totalFailures > 0 ? 'text-bakin-signal-danger' : 'text-bakin-signal-highlight'}`} aria-hidden="true" />
            <h3 id="activity-needs-attention-title" className="font-bakin-typography-weight-semibold text-bakin-text-primary">Hiccups</h3>
          </div>
          <p className="mt-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-bakin-2 text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
          {totalFailures > 0 && (
            <span>
              {failures.length < totalFailures
                ? `Showing ${failures.length.toLocaleString()} of ${totalFailures.toLocaleString()} failure events`
                : `${totalFailures.toLocaleString()} ${totalFailures === 1 ? 'failure' : 'failures'}`}
            </span>
          )}
          {totalUnverified > 0 && (
            <>
              {totalFailures > 0 && <span aria-hidden="true">·</span>}
              <span>{totalUnverified.toLocaleString()} {totalUnverified === 1 ? 'result to verify' : 'results to verify'}</span>
            </>
          )}
          {totalFailures > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {groups.length === 0 && patternTotal > 0
                  ? 'Refreshing failure patterns…'
                  : page && patternTotal > groups.length
                    ? `Patterns ${patternStart.toLocaleString()}–${patternEnd.toLocaleString()} of ${patternTotal.toLocaleString()}`
                    : `${groups.length.toLocaleString()} ${groups.length === 1 ? 'failure pattern' : 'failure patterns'}`}
              </span>
            </>
          )}
        </div>
      </div>

      {totalFailures > 0 && (
        <>
          <Panel tone="danger">
            <Grid layout="main-aside" gap="section" align="start">
            <div className="min-w-0">
              <h4 className="mb-bakin-2 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
                Failures over time
              </h4>
              <ActivityFailureTrend buckets={buckets} coverage={coverage} />
            </div>
            <FailurePatternHighlights groups={groups} page={page} />
            </Grid>
          </Panel>

          {hasPatterns && (
            <Button
              id="activity-failure-pattern-disclosure"
              size="sm"
              variant="outline"
              className="w-fit max-w-full text-bakin-text-muted hover:text-bakin-text-primary"
              aria-expanded={detailsExpanded}
              aria-controls="activity-failure-pattern-details"
              onClick={() => {
                if (detailsExpanded && page && page.offset > 0) {
                  setDetailsExpanded(false)
                  onPageChange?.(0, { expanded: false, focusTarget: 'disclosure' })
                  return
                }
                const nextExpanded = !detailsExpanded
                setDetailsExpanded(nextExpanded)
                onDetailsExpandedChange?.(nextExpanded)
              }}
            >
              {detailsExpanded ? 'Hide failure details' : reviewLabel}
              <ChevronDown
                className={detailsExpanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'}
                aria-hidden="true"
              />
            </Button>
          )}

          {hasPatterns && detailsExpanded && (
            <div id="activity-failure-pattern-details" className="space-y-bakin-4">
              <div className="border-y border-bakin-border-subtle">
                {groups.map((group) => (
                  <FailureGroup
                    key={failureGroupKey(group)}
                    group={group}
                    failures={failures}
                    selected={matchingGroup === group}
                  />
                ))}
              </div>

              {showPaging && page && onPageChange && (
                <Pagination
                  ariaLabel="Failure pattern pages"
                  page={Math.floor(page.offset / page.limit) + 1}
                  pageSize={page.limit}
                  total={page.total}
                  onPageChange={(nextPage) => onPageChange((nextPage - 1) * page.limit)}
                />
              )}

              <ResultsToVerify unverified={unverified} totalUnverified={totalUnverified} />
            </div>
          )}

          {!hasPatterns && totalUnverified > 0 && (
            <div>
              <ResultsToVerify unverified={unverified} totalUnverified={totalUnverified} />
            </div>
          )}
        </>
      )}

      {totalFailures === 0 && totalUnverified > 0 && (
        <Panel tone="attention">
          <ResultsToVerify unverified={unverified} totalUnverified={totalUnverified} />
        </Panel>
      )}
    </Section>
  )
}
