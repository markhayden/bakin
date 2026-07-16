'use client'

import { formatAbsoluteTime, formatRelativeTime, StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
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

function eventState(entry: UsageEntry): {
  label: string
  tone: StatusTone
  dot: string
} {
  if (entry.status === 'error') return { label: 'Failed', tone: 'destructive', dot: 'bg-destructive' }
  if (isUnverifiedActivity(entry)) return { label: 'Result not observed', tone: 'warning', dot: 'bg-warning' }
  if (isCanceledActivity(entry)) return { label: 'Canceled', tone: 'neutral', dot: 'bg-muted-foreground' }
  return { label: 'Succeeded', tone: 'success', dot: 'bg-success' }
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
    <li className="border-b border-border/70 last:border-b-0">
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @[34rem]/health:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
        aria-label={`View ${label} details — ${state.label}, ${sourceLabel}, ${owner}, ${when}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`size-2 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium text-foreground" title={entry.name}>{label}</strong>
          <span className="block truncate text-xs text-muted-foreground">
            {sourceLabel} · <span>{entry.agent ? `Agent: ${entry.agent}` : activityOwner(entry)}</span>
          </span>
          {context && <span className="mt-0.5 block text-xs text-muted-foreground">{context}</span>}
        </span>
        <StatusBadge tone={state.tone} variant="outline" className="justify-self-end">{state.label}</StatusBadge>
        <span className="col-start-2 row-start-2 flex items-center gap-1.5 text-xs text-muted-foreground @[34rem]/health:col-start-4 @[34rem]/health:row-start-1">
          <time dateTime={entry.ts} title={formatAbsoluteTime(entry.ts)}>{when}</time>
          <ChevronDown
            className={expanded ? 'size-3.5 rotate-180 transition-transform motion-reduce:transition-none' : 'size-3.5 transition-transform motion-reduce:transition-none'}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-foreground/[0.015] px-4 py-3">
          <p className="text-sm text-foreground">{failed ? activityFailureReason(entry) : activityImpact(entry)}</p>
          {failed && <p className="mt-1 text-xs text-muted-foreground">{activityImpact(entry)}</p>}
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground @[28rem]/health:grid-cols-[max-content_minmax(0,1fr)]">
            <dt>Raw name</dt><dd className="break-all font-mono text-foreground">{entry.name}</dd>
            <dt>Type</dt><dd className="text-foreground">{sourceLabel}</dd>
            <dt>Agent</dt><dd className="text-foreground">{activityOwner(entry)}</dd>
            <dt>Duration</dt><dd className="text-foreground">{entry.durationMs === null ? 'Not recorded' : `${entry.durationMs.toLocaleString()} ms`}</dd>
            {entry.meta && <><dt>Metadata</dt><dd className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-foreground">{JSON.stringify(entry.meta, null, 2)}</dd></>}
          </dl>
        </div>
      )}
    </li>
  )
}

export function ActivityEventStream({ data }: { data: UsageFeedData }) {
  const entries = activityStreamEntries(data)

  return (
    <section aria-labelledby="activity-recent-events-title" className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="activity-recent-events-title" className="font-semibold">Recent events</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.capabilities?.sourceBalancedActivity === true
              ? 'Newest visible calls from each source. Open one for details.'
              : 'Newest first. Open a row for the reason and technical evidence.'}
          </p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {entries.length.toLocaleString()} available · {data.totals.count.toLocaleString()} reported
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border/80 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No events were recorded in this window.
        </div>
      ) : (
        <ul className="max-h-[34rem] overflow-y-auto rounded-xl border border-border/80 bg-card" aria-label="Recent events">
          {entries.map((entry) => <ActivityEventRow key={eventIdentity(entry)} entry={entry} />)}
        </ul>
      )}
    </section>
  )
}
