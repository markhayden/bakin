'use client'

import { formatAbsoluteTime, formatRelativeTime, StatusBadge } from '@makinbakin/sdk/components'
import { Button } from '@makinbakin/sdk/ui'
import { AlertCircle, Bot, Braces, ChevronDown, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { UsageEntry, UsageFailureGroup, UsageFailureGroupPage, UsageKind } from '../types'
import { ActivityRow, activityFailureReason, formatActivityName } from './activity-row'

const KIND_META: Record<UsageKind, {
  label: string
  icon: typeof Wrench
  color: string
}> = {
  mcp: { label: 'Tools', icon: Wrench, color: 'text-chart-1' },
  rest: { label: 'API', icon: Braces, color: 'text-chart-2' },
  agent: { label: 'Agents', icon: Bot, color: 'text-chart-3' },
}

export const FAILURE_PATTERN_PREVIEW_LIMIT = 3

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

function eventButtonLabel(visible: number, total: number): string {
  if (visible === total) return `View ${visible.toLocaleString()} failure ${visible === 1 ? 'event' : 'events'}`
  return `View ${visible.toLocaleString()} of ${total.toLocaleString()} recent failure events`
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
}: {
  group: UsageFailureGroup
  failures: UsageEntry[]
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = KIND_META[group.kind]
  const Icon = meta.icon
  const destination = group.destination ?? group.name
  const displayName = `${group.method ? `${group.method} ` : ''}${formatActivityName(destination)}`
  const label = `${meta.label} · ${displayName}`
  const events = matchingFailures(group, failures)
  const latest = group.latestFailure ?? events[0]
  const reason = latest ? activityFailureReason(latest) : 'No failure reason was reported.'
  const relative = relativeFailureTime(group.lastFailureAt)
  const agents = failureAgents(group)
  const disclosureId = `activity-failure-events-${group.kind}-${group.method ?? 'none'}-${encodeURIComponent(destination)}`

  return (
    <div role="group" aria-label={label} className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="grid min-w-0 gap-3 p-4 @[38rem]/health:grid-cols-[minmax(0,1fr)_auto] @[38rem]/health:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Icon className={`size-4 shrink-0 ${meta.color}`} aria-hidden="true" />
            <h4 className="min-w-0 truncate font-semibold text-foreground" title={destination}>
              {displayName}
            </h4>
            <StatusBadge tone="destructive" variant="outline">{meta.label}</StatusBadge>
          </div>

          <p className="mt-2 truncate text-sm text-foreground" title={reason}>{reason}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <strong className="font-medium tabular-nums text-destructive">{failureCountLabel(group)}</strong>
            <span className="min-w-0 truncate" title={agents}>
              {agents}
            </span>
            <span>
              Last failed{' '}
              <time dateTime={group.lastFailureAt} title={formatAbsoluteTime(group.lastFailureAt)}>
                {relative}
              </time>
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          aria-label={`${eventButtonLabel(events.length, group.failures)} for ${label}`}
          aria-expanded={expanded}
          aria-controls={disclosureId}
          onClick={() => setExpanded((value) => !value)}
          disabled={events.length === 0}
        >
          {eventButtonLabel(events.length, group.failures)}
          <ChevronDown
            className={expanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'}
            aria-hidden="true"
          />
        </Button>
      </div>

      {expanded && (
        <div
          id={disclosureId}
          className="border-t border-border/70 bg-foreground/[0.015] p-3"
        >
          {events.length < group.failures && (
            <p className="mb-3 text-xs text-muted-foreground">
              Showing the {events.length.toLocaleString()} most recent of {group.failures.toLocaleString()} failures in this window.
            </p>
          )}
          <ul className="space-y-2" aria-label={`Failure events for ${label}`}>
            {events.map((entry, index) => (
              <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
            ))}
          </ul>
        </div>
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
  page,
  onPageChange,
}: {
  groups: UsageFailureGroup[]
  failures: UsageEntry[]
  totalFailures: number
  unverified: UsageEntry[]
  totalUnverified: number
  page?: UsageFailureGroupPage
  onPageChange?: (offset: number) => void
}) {
  const [patternsExpanded, setPatternsExpanded] = useState(false)
  if (totalFailures === 0 && totalUnverified === 0) return null
  const patternTotal = page?.total ?? groups.length
  const patternStart = groups.length > 0 ? (page?.offset ?? 0) + 1 : 0
  const patternEnd = groups.length > 0 ? (page?.offset ?? 0) + groups.length : 0
  const showPaging = page !== undefined && (page.offset > 0 || page.hasMore)
  const hiddenPatternCount = Math.max(0, groups.length - FAILURE_PATTERN_PREVIEW_LIMIT)
  const visibleGroups = patternsExpanded
    ? groups
    : groups.slice(0, FAILURE_PATTERN_PREVIEW_LIMIT)
  const description = totalFailures > 0
    ? totalUnverified > 0
      ? 'Repeated failures are grouped. Calls missing a final result are listed separately.'
      : 'Repeated failures are grouped so the biggest patterns stand out first.'
    : 'These calls ended without a final result event, so Bakin cannot confirm their outcome.'

  return (
    <section id="activity-needs-attention" aria-labelledby="activity-needs-attention-title" className="scroll-mt-4 space-y-3" tabIndex={-1}>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <AlertCircle className={`size-4 ${totalFailures > 0 ? 'text-destructive' : 'text-warning'}`} aria-hidden="true" />
            <h3 id="activity-needs-attention-title" className="font-semibold">Needs attention</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs tabular-nums text-muted-foreground">
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
        <div id="activity-failure-pattern-list" className="space-y-2">
          {visibleGroups.map((group) => (
            <FailureGroup
              key={`${group.kind}:${group.method ?? ''}:${group.destination ?? group.name}`}
              group={group}
              failures={failures}
            />
          ))}
        </div>
      )}

      {totalFailures > 0 && hiddenPatternCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-center text-muted-foreground hover:text-foreground"
          aria-expanded={patternsExpanded}
          aria-controls="activity-failure-pattern-list"
          onClick={() => setPatternsExpanded((value) => !value)}
        >
          {patternsExpanded
            ? 'Show fewer failure patterns'
            : `Show ${hiddenPatternCount.toLocaleString()} more failure ${hiddenPatternCount === 1 ? 'pattern' : 'patterns'}`}
          <ChevronDown
            className={patternsExpanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'}
            aria-hidden="true"
          />
        </Button>
      )}

      {showPaging && (
        <nav aria-label="Failure pattern pages" className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Previous failure patterns"
            disabled={page.offset === 0 || !onPageChange}
            onClick={() => onPageChange?.(Math.max(0, page.offset - page.limit))}
          >
            Previous patterns
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Next failure patterns"
            disabled={!page.hasMore || !onPageChange}
            onClick={() => onPageChange?.(page.offset + page.limit)}
          >
            Next patterns
          </Button>
        </nav>
      )}

      {totalUnverified > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
            <div>
              <h4 className="font-semibold text-foreground">Results to verify</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirm whether these calls completed before retrying them.
              </p>
            </div>
            {unverified.length < totalUnverified && (
              <span className="text-xs tabular-nums text-muted-foreground">
                Showing {unverified.length.toLocaleString()} of {totalUnverified.toLocaleString()}
              </span>
            )}
          </div>
          {unverified.length > 0 ? (
            <ul className="space-y-2" aria-label="Results to verify">
              {unverified.map((entry, index) => (
                <ActivityRow key={entry.id || `${entry.ts}:${entry.kind}:${entry.name}:${index}`} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-muted-foreground">
              No recent raw evidence is available for these result gaps.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
