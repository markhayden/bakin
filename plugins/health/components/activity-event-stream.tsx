'use client'

import { formatAbsoluteTime, formatRelativeTime } from '@makinbakin/sdk/conversation'
import { Section } from '@makinbakin/sdk/layout'
import { PageNavigator, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { SystemState } from '@makinbakin/sdk/ui'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { UsageEntry, UsageFeedData } from '../types'
import {
  activityFailureReason,
  activityImpact,
  activityOwner,
  formatActivityName,
  isCanceledActivity,
  isUnverifiedActivity,
} from './activity-row'
import { INTERACTION_SOURCE_META } from './interaction-source-meta'

const EVENT_PAGE_SIZE = 10

function eventState(entry: UsageEntry): {
  label: string
  tone: StatusTone
  dot: string
} {
  if (entry.status === 'error') return { label: 'Failed', tone: 'danger', dot: 'bg-bakin-signal-danger' }
  if (isUnverifiedActivity(entry)) return { label: 'Result not observed', tone: 'attention', dot: 'bg-bakin-signal-highlight' }
  if (isCanceledActivity(entry)) return { label: 'Canceled', tone: 'neutral', dot: 'bg-bakin-text-muted' }
  return { label: 'Succeeded', tone: 'success', dot: 'bg-bakin-action-primary-background' }
}

function relativeEventTime(value: string): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return 'just now'
  return /^\d+[mhd]$/.test(relative) ? `${relative} ago` : relative
}

function eventIdentity(entry: UsageEntry): string {
  return entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${entry.agent ?? ''}`
}

export function activityStreamEntries(data: UsageFeedData): UsageEntry[] {
  const seen = new Set<string>()
  return [...data.recent, ...data.recentFailures, ...data.recentUnverified]
    .filter((entry) => {
      const key = eventIdentity(entry)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => right.ts.localeCompare(left.ts))
}

function ActivityEventRow({ entry }: { entry: UsageEntry }) {
  const [expanded, setExpanded] = useState(false)
  const state = eventState(entry)
  const failed = entry.status === 'error'
  const context = !failed && (isCanceledActivity(entry) || isUnverifiedActivity(entry))
    ? activityImpact(entry)
    : null
  const label = formatActivityName(entry.name)
  const owner = entry.agent ? `Agent ${entry.agent}` : activityOwner(entry)
  const when = relativeEventTime(entry.ts)
  const sourceLabel = INTERACTION_SOURCE_META[entry.kind].label

  return (
    <li className="border-b border-bakin-border-subtle last:border-b-0">
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-bakin-3 gap-y-bakin-1 px-bakin-3 py-bakin-3 text-left hover:bg-bakin-surface-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bakin-focus-ring @[34rem]/health:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
        aria-label={`View ${label} details — ${state.label}, ${sourceLabel}, ${owner}, ${when}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`size-2 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
        <span className="min-w-0">
          <strong className="block truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary" title={entry.name}>{label}</strong>
          <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">
            {sourceLabel} · <span>{entry.agent ? `Agent: ${entry.agent}` : activityOwner(entry)}</span>
          </span>
          {context && <span className="mt-bakin-1 block text-bakin-typography-size-meta text-bakin-text-muted">{context}</span>}
        </span>
        <StatusBadge tone={state.tone} variant="solid" className="justify-self-end">{state.label}</StatusBadge>
        <span className="col-start-2 row-start-2 flex items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted @[34rem]/health:col-start-4 @[34rem]/health:row-start-1">
          <time dateTime={entry.ts} title={formatAbsoluteTime(entry.ts)}>{when}</time>
          <ChevronDown
            className={expanded ? 'size-3.5 rotate-180 transition-transform motion-reduce:transition-none' : 'size-3.5 transition-transform motion-reduce:transition-none'}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3">
          <p className="text-bakin-typography-size-body text-bakin-text-primary">{failed ? activityFailureReason(entry) : activityImpact(entry)}</p>
          {failed && <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{activityImpact(entry)}</p>}
          <dl className="mt-bakin-3 grid gap-x-bakin-4 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted @[28rem]/health:grid-cols-[max-content_minmax(0,1fr)]">
            <dt>Raw name</dt><dd className="break-all font-mono text-bakin-text-primary">{entry.name}</dd>
            <dt>Type</dt><dd className="text-bakin-text-primary">{sourceLabel}</dd>
            <dt>Agent</dt><dd className="text-bakin-text-primary">{activityOwner(entry)}</dd>
            <dt>Duration</dt><dd className="text-bakin-text-primary">{entry.durationMs === null ? 'Not recorded' : `${entry.durationMs.toLocaleString()} ms`}</dd>
            {entry.meta && <><dt>Metadata</dt><dd className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-bakin-text-primary">{JSON.stringify(entry.meta, null, 2)}</dd></>}
          </dl>
        </div>
      )}
    </li>
  )
}

export function ActivityEventStream({ data }: { data: UsageFeedData }) {
  const entries = activityStreamEntries(data)
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const pageCount = Math.max(1, Math.ceil(entries.length / EVENT_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visibleEntries = showAll
    ? entries
    : entries.slice((safePage - 1) * EVENT_PAGE_SIZE, safePage * EVENT_PAGE_SIZE)

  return (
    <Section
      aria-labelledby="activity-recent-events-title"
      divider="top"
      spacing="compact"
    >
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="activity-recent-events-title" className="font-bakin-typography-weight-semibold text-bakin-text-primary">Recent events</h3>
          <p className="mt-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">
            {data.capabilities?.sourceBalancedActivity === true
              ? 'Newest visible calls from each source. Open one for details.'
              : 'Newest first. Open a row for the reason and technical evidence.'}
          </p>
        </div>
        <span className="text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
          {entries.length.toLocaleString()} available · {data.totals.count.toLocaleString()} reported
        </span>
      </div>

      {entries.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          headingLevel={4}
          title="No events in this window"
          description="Activity will appear here as Bakin records calls."
        />
      ) : (
        <>
          <ul className="border-y border-bakin-border-subtle" aria-label="Recent events">
            {visibleEntries.map((entry) => <ActivityEventRow key={eventIdentity(entry)} entry={entry} />)}
          </ul>
          <PageNavigator
            ariaLabel="Recent event pagination"
            page={safePage}
            pageSize={EVENT_PAGE_SIZE}
            showAll={showAll}
            total={entries.length}
            onPageChange={setPage}
            onShowAllChange={(nextShowAll) => {
              setShowAll(nextShowAll)
              setPage(1)
            }}
          />
        </>
      )}
    </Section>
  )
}
