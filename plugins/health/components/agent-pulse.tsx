'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import type { AgentUsage } from '@makinbakin/sdk/types'
import { CompositionBar } from '@makinbakin/sdk/charts'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { ListRow, ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  SystemState,
} from '@makinbakin/sdk/ui'
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
      <p className="text-bakin-typography-size-meta font-bakin-typography-weight-medium uppercase tracking-wide text-bakin-text-muted">{label}</p>
      <div className="mt-bakin-1">{children}</div>
    </div>
  )
}

function ReviewStatus({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
  if (checking) {
    return <StatusBadge tone="neutral" variant="outline">Checking review</StatusBadge>
  }
  if (row.reviewState === 'review') {
    return <StatusBadge tone="attention" variant="outline">Review</StatusBadge>
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
  const interactive = row.effort?.interactiveTokens ?? null
  const unexplained = row.effort?.unexplainedTokens ?? null
  const outside = interactive !== null && unexplained !== null ? interactive + unexplained : null
  const attributed = alignedObserved !== null && outside !== null
    ? Math.max(0, alignedObserved - outside)
    : null
  const reportedCost = row.historyCostUsdMicros
  const trackedCost = row.effort?.windowCostUsdMicros ?? null
  const checkingUsage = observed === null && (pending.history || pending.effort)
  const checkingCost = reportedCost === null
    && trackedCost === null
    && (pending.history || pending.effort)

  return (
    <Metric label="Usage & cost">
      <p className="font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">
        {checkingUsage
          ? 'Checking usage…'
          : observed === null
            ? 'Usage unavailable'
            : `${formatTokenCount(observed)} tokens`}
      </p>
      {alignedObserved !== null && alignedObserved > 0 && attributed !== null && interactive !== null && unexplained !== null && (
        <div className="my-bakin-1">
          <CompositionBar
            size="inline"
            data={[
              { key: 'attributed', label: 'Tracked work', value: attributed },
              { key: 'interactive', label: 'Interactive sessions', value: interactive },
              { key: 'unexplained', label: 'Unexplained', value: unexplained },
            ]}
            label={`${row.agent} usage mix`}
            formatValue={formatTokenCount}
          />
        </div>
      )}
      <p className="text-bakin-typography-size-meta text-bakin-text-muted">
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
        <p className="text-bakin-typography-size-body text-bakin-text-muted">Checking…</p>
      ) : percent === null ? (
        <p className="text-bakin-typography-size-body text-bakin-text-muted">Unavailable</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-bakin-3">
            <p className="font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">{percent}%</p>
            <p className="text-bakin-typography-size-meta text-bakin-text-muted">of budget</p>
          </div>
          <Progress
            className="mt-bakin-1"
            aria-label={`${row.agent} startup context budget`}
            value={Math.min(100, percent)}
            getAriaValueText={() => `${percent}% of budget`}
            tone={percent > 90 ? 'attention' : 'accent'}
          />
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
      className="border-t border-bakin-border-subtle pt-bakin-3"
    >
      {session ? (
        <div>
          <div className="grid gap-bakin-3 @[36rem]/agent-pulse:grid-cols-[minmax(11rem,1.5fr)_repeat(4,minmax(5rem,1fr))]">
            <div className="min-w-0">
              <p className="truncate font-bakin-typography-weight-medium text-bakin-text-primary" title={session.model}>{session.model}</p>
              <p className="text-bakin-typography-size-meta text-bakin-text-muted">
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
                <dt className="text-bakin-typography-size-meta uppercase tracking-wide text-bakin-text-muted">{label}</dt>
                <dd className="mt-bakin-0 font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary">{formatTokenCount(value)}</dd>
              </dl>
            ))}
          </div>
          {costLabel && (
            <p className="mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">{costLabel}</p>
          )}
        </div>
      ) : checking ? (
        <p className="text-bakin-typography-size-body text-bakin-text-muted">Checking latest session…</p>
      ) : unavailable ? (
        <p className="text-bakin-typography-size-body text-bakin-text-muted">Latest-session detail is unavailable.</p>
      ) : (
        <p className="text-bakin-typography-size-body text-bakin-text-muted">No latest-session token breakdown is available.</p>
      )}
      <PluginLink
        to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
        className="mt-bakin-3 inline-flex items-center gap-bakin-1 rounded-bakin-control text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-signal-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
      >
        Open {row.agent} diagnostics <ArrowUpRight className="size-bakin-3" aria-hidden="true" />
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
    <ListRow
      aria-labelledby={headingId}
      data-agent-pulse-row
      className="p-bakin-4"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-bakin-2">
          <h4 id={headingId} className="font-bakin-typography-weight-semibold text-bakin-text-primary">{row.agent}</h4>
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
            ? 'mt-bakin-1 line-clamp-2 text-bakin-typography-size-meta text-bakin-text-muted'
            : 'mt-bakin-1 truncate text-bakin-typography-size-meta text-bakin-text-muted'}
          title={activitySummary}
        >
          {activitySummary}
        </p>
        {row.liveRunCount > 1 && (
          <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-signal-accent">{plural(row.liveRunCount, 'concurrent run')}</p>
        )}
      </div>
      <UsageMetric row={row} pending={pending} />
      <Metric label="Tracked work">
        {pending.effort ? (
          <p className="text-bakin-typography-size-body text-bakin-text-muted">Checking…</p>
        ) : row.effort ? (
          <>
            <p className="font-bakin-typography-weight-medium text-bakin-text-primary">{plural(row.effort.runs, 'tracked run')}</p>
            <p className="text-bakin-typography-size-meta text-bakin-text-muted">
              {row.effort.windowTokens === null
                ? `Token totals unavailable${tokenCoverage ? ` · ${tokenCoverage}` : ''}`
                : `${formatTokenCount(row.effort.windowTokens)} tracked tokens`}
            </p>
            <p className="text-bakin-typography-size-meta text-bakin-text-muted">
              {plural(row.effort.completions, 'task completion')}
              {costCoverage ? ` · cost ${costCoverage}` : ''}
            </p>
          </>
        ) : (
          <p className="text-bakin-typography-size-body text-bakin-text-muted">Work evidence unavailable</p>
        )}
      </Metric>
      <ContextMetric row={row} checking={pending.context || pending.settings} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-self-start @3xl/list-rows:justify-self-end"
        aria-label={`View ${row.agent} details`}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        Details
        <ChevronDown className={expanded ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'} aria-hidden="true" />
      </Button>
      {expanded && (
        <div className="col-span-full min-w-0">
          <LatestSessionDetails
            row={row}
            id={detailsId}
            checking={pending.latestSessions}
            unavailable={unavailable.latestSessions}
          />
        </div>
      )}
    </ListRow>
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
    <Card className="min-w-0" data-section-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-bakin-2">
          <Bot className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
          <h3>Agent pulse</h3>
        </CardTitle>
        <CardDescription className="max-w-3xl">
          Selected-period usage and tracked work, alongside live state, latest-session detail, and startup context.
        </CardDescription>
        {rows.length > 0 && (
          <CardAction>
            <p className="text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
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
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
      <div className="@container/agent-pulse space-y-bakin-3">
        {loading && rows.length === 0 ? (
          <div role="status" aria-label="Loading agent pulse" className="space-y-bakin-2">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : error && rows.length === 0 ? (
          <SystemState
            kind="error"
            scope="section"
            headingLevel={4}
            title="Agent pulse unavailable"
            description={error}
            action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="section"
            headingLevel={4}
            title="No agent evidence is available in this window."
            description="Choose a longer window if you expected recent activity."
          />
        ) : (
          <ListRows
            variant="bordered"
            aria-label="Agent pulse"
            columns="minmax(8rem,1.2fr) minmax(9rem,1fr) minmax(8rem,.8fr) minmax(7rem,.7fr) auto"
            columnsAt="3xl"
            columnsAlign="center"
          >
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
          </ListRows>
        )}
        {mixedEvidence && (
          <p className="text-bakin-typography-size-meta text-bakin-text-muted">
            Usage and tracked-work evidence came from separate refreshes.
          </p>
        )}
        {rows.length > 0 && error && (
          <p role="status" className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
            <Activity className="size-bakin-3" aria-hidden="true" /> Some agent evidence is unavailable: {error}.
          </p>
        )}
      </div>
      </CardContent>
    </Card>
  )
}
