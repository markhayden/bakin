'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import type { AgentUsage } from '@makinbakin/sdk/types'
import { EmptyState, ErrorState, PluginLink, SectionCard, StatusBadge } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import { Activity, ArrowUpRight, Bot, ChevronDown } from 'lucide-react'
import type {
  AgentEffortData,
  ContextSummaryData,
  LiveNowData,
  UsageHistoryData,
} from '../types'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'
import {
  buildAgentPulseRows,
  hasCurrentAgentEffortCoverage,
  type AgentPulseRow,
} from '../lib/agent-pulse-view-model'

export interface AgentPulsePending {
  effort: boolean
  history: boolean
  latestSessions: boolean
  liveNow: boolean
  context: boolean
  settings: boolean
}

export interface AgentPulseProps {
  effort: AgentEffortData | null
  history: UsageHistoryData | null
  latestSessions: AgentUsage[] | null
  liveNow: LiveNowData | null
  context: ContextSummaryData | null
  contextBudgetBytes: number | null
  pending: AgentPulsePending
  unavailable: AgentPulsePending
  errors: string[]
  latestSessionFailedAgents?: string[]
  liveNowStale?: boolean
  onRetry: () => void
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

function latestSessionCostLabel(session: AgentUsage): string | null {
  if (session.cost.total === null) return null
  const cost = formatRuntimeCost(session.cost.total)
  if (session.costedMessages === undefined) {
    return `${cost}+ reported cost · coverage unavailable`
  }
  if (session.costedMessages < session.messages) {
    return `${cost}+ reported cost · ${session.costedMessages} of ${session.messages} messages`
  }
  return `${cost} reported cost`
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function ReviewStatus({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
  if (checking) {
    return <StatusBadge tone="neutral" variant="outline">Checking review</StatusBadge>
  }
  if (row.reviewState === 'review') {
    return <StatusBadge tone="warning" variant="outline">Review</StatusBadge>
  }
  if (row.reviewState === 'clear') {
    return <StatusBadge tone="success" variant="outline">No review flags</StatusBadge>
  }
  if (row.effort && !hasCurrentAgentEffortCoverage(row.effort)) {
    return <StatusBadge tone="neutral" variant="outline">Coverage unavailable</StatusBadge>
  }
  if (row.effort && row.effort.runs > 0 && row.effort.windowTokens === null) {
    return <StatusBadge tone="neutral" variant="outline">Metering incomplete</StatusBadge>
  }
  return <StatusBadge tone="neutral" variant="outline">Coverage unavailable</StatusBadge>
}

function UsageMetric({ row, pending }: { row: AgentPulseRow; pending: AgentPulsePending }) {
  const observed = row.observedTokens
  const alignedObserved = row.effort?.totalObservedTokens ?? null
  const outside = row.effort?.unattributedTokens ?? null
  const attributed = alignedObserved !== null && outside !== null
    ? Math.max(0, alignedObserved - outside)
    : null
  const attributedPercent = alignedObserved && attributed !== null
    ? Math.min(100, (attributed / alignedObserved) * 100)
    : 0
  const outsidePercent = alignedObserved && outside !== null
    ? Math.min(100, (outside / alignedObserved) * 100)
    : 0
  const reportedCost = row.historyCostUsdMicros
  const trackedCost = row.effort?.windowCostUsdMicros ?? null
  const checkingUsage = observed === null && (pending.history || pending.effort)
  const checkingCost = reportedCost === null
    && trackedCost === null
    && (pending.history || pending.effort)

  return (
    <Metric label="Usage & cost">
      <p className="font-semibold tabular-nums text-foreground">
        {checkingUsage
          ? 'Checking usage…'
          : observed === null
            ? 'Usage unavailable'
            : `${formatTokenCount(observed)} tokens`}
      </p>
      {alignedObserved !== null && alignedObserved > 0 && attributed !== null && outside !== null && (
        <div
          role="img"
          aria-label={`${Math.round(attributedPercent)}% tracked work and ${Math.round(outsidePercent)}% outside tracked work`}
          className="my-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <span className="bg-primary" style={{ width: `${attributedPercent}%` }} />
          <span className="bg-warning" style={{ width: `${outsidePercent}%` }} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {reportedCost !== null
          ? `${formatRuntimeCost(reportedCost / 1_000_000)}${row.costedMessages < row.messageCount ? '+' : ''} reported cost${row.costedMessages < row.messageCount ? ` · partial (${row.costedMessages}/${row.messageCount} messages)` : ''}`
          : trackedCost !== null
            ? `${formatRuntimeCost(trackedCost / 1_000_000)} tracked cost`
            : checkingCost
              ? 'Checking cost…'
              : 'Cost unavailable'}
      </p>
    </Metric>
  )
}

function ContextMetric({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
  const percent = row.startupContextPercent
  return (
    <Metric label="Startup context">
      {checking ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : percent === null ? (
        <p className="text-sm text-muted-foreground">Unavailable</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold tabular-nums text-foreground">{percent}%</p>
            <p className="text-xs text-muted-foreground">of budget</p>
          </div>
          <div
            role="progressbar"
            aria-label={`${row.agent} startup context budget`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, percent)}
            aria-valuetext={`${percent}% of budget`}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <span
              className={percent > 90 ? 'block h-full bg-warning' : 'block h-full bg-accent'}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        </>
      )}
    </Metric>
  )
}

function LatestSessionDetails({ row, id, checking, unavailable }: {
  row: AgentPulseRow
  id: string
  checking: boolean
  unavailable: boolean
}) {
  const session = row.latestSession
  const costLabel = session ? latestSessionCostLabel(session) : null
  return (
    <div
      id={id}
      role="region"
      aria-label={`${row.agent} details`}
      className="border-t border-foreground/10 bg-foreground/[0.018] px-4 py-3"
    >
      {session ? (
        <div>
          <div className="grid gap-3 @[36rem]/agent-pulse:grid-cols-[minmax(11rem,1.5fr)_repeat(4,minmax(5rem,1fr))]">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground" title={session.model}>{session.model}</p>
              <p className="text-xs text-muted-foreground">
                {plural(session.messages, 'message')} · {formatTokenCount(session.tokens.total)} tokens
              </p>
            </div>
            {([
              ['Input', session.tokens.input],
              ['Output', session.tokens.output],
              ['Cache read', session.tokens.cacheRead],
              ['Cache write', session.tokens.cacheWrite],
            ] as const).map(([label, value]) => (
              <dl key={label}>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-foreground">{formatTokenCount(value)}</dd>
              </dl>
            ))}
          </div>
          {costLabel && (
            <p className="mt-2 text-xs text-muted-foreground">{costLabel}</p>
          )}
        </div>
      ) : checking ? (
        <p className="text-sm text-muted-foreground">Checking latest session…</p>
      ) : unavailable ? (
        <p className="text-sm text-muted-foreground">Latest-session detail is unavailable.</p>
      ) : (
        <p className="text-sm text-muted-foreground">No latest-session token breakdown is available.</p>
      )}
      <PluginLink
        to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
        className="mt-3 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open {row.agent} diagnostics <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </PluginLink>
    </div>
  )
}

function AgentPulseRowView({ row, expanded, pending, unavailable, liveNowStale, onToggle }: {
  row: AgentPulseRow
  expanded: boolean
  pending: AgentPulsePending
  unavailable: AgentPulsePending
  liveNowStale: boolean
  onToggle: () => void
}) {
  const detailsId = useId()
  const headingId = useId()
  const flag = row.effort?.flags[0]
  const tokenCoverage = !row.effort || !hasCurrentAgentEffortCoverage(row.effort)
    ? 'coverage unavailable'
    : row.effort.tokenAggregateRepresentable === false
      ? `${row.effort.tokenMeteredRuns} of ${row.effort.tokenApplicableRuns} token-bearing calls reported totals · combined total too large to report`
      : row.effort.tokenMeteredRuns !== row.effort.tokenApplicableRuns
        ? `${row.effort.tokenMeteredRuns} of ${row.effort.tokenApplicableRuns} token-bearing calls metered`
        : null
  const costCoverage = !row.effort || !hasCurrentAgentEffortCoverage(row.effort)
    ? 'coverage unavailable'
    : row.effort.costAggregateRepresentable === false
      ? `${row.effort.costedRuns} of ${row.effort.runs} runs priced · combined cost too large to report`
      : row.effort.costedRuns !== row.effort.runs
        ? `${row.effort.costedRuns} of ${row.effort.runs} runs priced`
        : null
  const activitySummary = row.liveRun
    ? row.liveRun.taskTitle ?? 'Active task title unavailable'
    : flag?.message
      ?? (pending.liveNow
        ? 'Checking live state…'
        : unavailable.liveNow
          ? 'Live state unavailable'
        : liveNowStale
          ? 'Live state is stale'
          : 'No active task reported')
  return (
    <article
      aria-labelledby={headingId}
      data-agent-pulse-row
      className="overflow-hidden rounded-xl bg-foreground/[0.025] ring-1 ring-foreground/10"
    >
      <div className="grid min-w-0 gap-4 p-4 @[44rem]/agent-pulse:grid-cols-[minmax(8rem,1.2fr)_minmax(9rem,1fr)_minmax(8rem,.8fr)_minmax(7rem,.7fr)_auto] @[44rem]/agent-pulse:items-center @[44rem]/agent-pulse:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id={headingId} className="font-semibold text-foreground">{row.agent}</h4>
            <ReviewStatus row={row} checking={pending.effort} />
            {row.liveRun
              ? liveNowStale
                ? <StatusBadge tone="neutral">Last seen working</StatusBadge>
                : <StatusBadge tone="accent">Working</StatusBadge>
              : pending.liveNow
                ? <StatusBadge tone="neutral">Checking live state</StatusBadge>
                : unavailable.liveNow
                  ? <StatusBadge tone="neutral">Live state unavailable</StatusBadge>
                  : liveNowStale
                    ? <StatusBadge tone="neutral">Live state stale</StatusBadge>
                : null}
          </div>
          <p
            className={flag && !row.liveRun
              ? 'mt-1 line-clamp-2 text-xs text-muted-foreground'
              : 'mt-1 truncate text-xs text-muted-foreground'}
            title={activitySummary}
          >
            {activitySummary}
          </p>
          {row.liveRunCount > 1 && (
            <p className="mt-1 text-[10px] text-accent">{plural(row.liveRunCount, 'concurrent run')}</p>
          )}
        </div>
        <UsageMetric row={row} pending={pending} />
        <Metric label="Tracked work">
          {pending.effort ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : row.effort ? (
            <>
              <p className="font-medium text-foreground">{plural(row.effort.runs, 'tracked run')}</p>
              <p className="text-xs text-muted-foreground">
                {row.effort.windowTokens === null
                  ? `Token totals unavailable${tokenCoverage ? ` · ${tokenCoverage}` : ''}`
                  : `${formatTokenCount(row.effort.windowTokens)} tracked tokens`}
              </p>
              <p className="text-xs text-muted-foreground">
                {plural(row.effort.completions, 'task completion')}
                {costCoverage ? ` · cost ${costCoverage}` : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Work evidence unavailable</p>
          )}
        </Metric>
        <ContextMetric row={row} checking={pending.context || pending.settings} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`View ${row.agent} details`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          Details
          <ChevronDown className={expanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'} aria-hidden="true" />
        </Button>
      </div>
      {expanded && (
        <LatestSessionDetails
          row={row}
          id={detailsId}
          checking={pending.latestSessions}
          unavailable={unavailable.latestSessions}
        />
      )}
    </article>
  )
}

/** One fleet surface for live state, spend, tracked work, context, and review signals. */
export function AgentPulse({
  effort,
  history,
  latestSessions,
  liveNow,
  context,
  contextBudgetBytes,
  pending,
  unavailable,
  errors,
  latestSessionFailedAgents = [],
  liveNowStale = false,
  onRetry,
}: AgentPulseProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const rows = useMemo(() => buildAgentPulseRows({
    effort,
    history,
    latestSessions: latestSessions ?? [],
    liveNow,
    context,
    contextBudgetBytes,
  }), [context, contextBudgetBytes, effort, history, latestSessions, liveNow])
  const working = rows.filter((row) => row.liveRun !== null).length
  const review = rows.filter((row) => row.reviewState === 'review').length
  const mixedEvidence = rows.some((row) => !row.evidenceAligned && row.effort && row.history)
  const loading = Object.values(pending).some(Boolean)
  const error = errors.length > 0 ? errors.join('; ') : null
  const failedLatestSessions = new Set(latestSessionFailedAgents)

  return (
    <SectionCard
      title={<h3>Agent pulse</h3>}
      icon={Bot}
      description="Selected-period usage and tracked work, alongside live state, latest-session detail, and startup context."
      action={rows.length > 0 ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {pending.liveNow
            ? 'Checking live activity'
            : unavailable.liveNow
              ? 'Live activity unavailable'
            : liveNowStale && working > 0
              ? plural(working, 'agent last seen working', 'agents last seen working')
              : liveNowStale
                ? 'Live activity stale'
              : plural(working, 'working agent')}
          {' · '}
          {pending.effort ? 'Checking review flags' : plural(review, 'to review', 'to review')}
        </p>
      ) : undefined}
      className="min-w-0"
    >
      <div className="@container/agent-pulse space-y-3">
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="Loading agent pulse" className="space-y-2">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : error && rows.length === 0 ? (
          <ErrorState title="Agent pulse unavailable" message={error} retry={onRetry} className="py-8" />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="section"
            title="No agent evidence is available in this window."
            description="Choose a longer window if you expected recent activity."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <AgentPulseRowView
                key={row.agent}
                row={row}
                expanded={expandedAgent === row.agent}
                pending={pending}
                unavailable={failedLatestSessions.has(row.agent)
                  ? { ...unavailable, latestSessions: true }
                  : unavailable}
                liveNowStale={liveNowStale}
                onToggle={() => setExpandedAgent((current) => current === row.agent ? null : row.agent)}
              />
            ))}
          </div>
        )}
        {mixedEvidence && (
          <p className="text-xs text-muted-foreground">
            Usage and tracked-work evidence came from separate refreshes.
          </p>
        )}
        {rows.length > 0 && error && (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="size-3.5" aria-hidden="true" /> Some agent evidence is unavailable: {error}.
          </p>
        )}
      </div>
    </SectionCard>
  )
}
