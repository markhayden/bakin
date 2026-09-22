'use client'

import { useMemo } from 'react'
import type { AgentUsage } from '@makinbakin/sdk/types'
import { CompositionBar } from '@makinbakin/sdk/charts'
import { PluginLink, useQueryState } from '@makinbakin/sdk/navigation'
import { Grid } from '@makinbakin/sdk/layout'
import { DataTable, KeyValue, StatusBadge, type DataTableColumn } from '@makinbakin/sdk/patterns'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerSection,
  Progress,
  Skeleton,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { Activity, ArrowUpRight, Bot, ChevronRight } from 'lucide-react'
import { HealthTableSort, useHealthTableSort } from './health-table-sort'
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

function ReviewStatus({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
  if (checking) {
    return <StatusBadge tone="neutral" variant="solid" size="xs">Checking review</StatusBadge>
  }
  if (row.reviewState === 'review') {
    return <StatusBadge tone="attention" variant="solid" size="xs">Review</StatusBadge>
  }
  if (row.reviewState === 'clear') {
    return <StatusBadge tone="success" variant="solid" size="xs">No review flags</StatusBadge>
  }
  if (row.effort && !hasCurrentAgentEffortCoverage(row.effort)) {
    return <StatusBadge tone="neutral" variant="solid" size="xs">Coverage unavailable</StatusBadge>
  }
  if (row.effort && row.effort.runs > 0 && row.effort.windowTokens === null) {
    return <StatusBadge tone="neutral" variant="solid" size="xs">Metering incomplete</StatusBadge>
  }
  return <StatusBadge tone="neutral" variant="solid" size="xs">Coverage unavailable</StatusBadge>
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
    <div className="min-w-0">
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
      <Text size="meta" tone="muted" as="p">
        {reportedCost !== null
          ? `${formatRuntimeCost(reportedCost / 1_000_000)}${row.costedMessages < row.messageCount ? '+' : ''} reported cost${row.costedMessages < row.messageCount ? ` · partial (${row.costedMessages}/${row.messageCount} messages)` : ''}`
          : trackedCost !== null
            ? `${formatRuntimeCost(trackedCost / 1_000_000)} tracked cost`
            : checkingCost
              ? 'Checking cost…'
              : 'Cost unavailable'}
      </Text>
    </div>
  )
}

function ContextMetric({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
  const percent = row.startupContextPercent
  return (
    <div className="min-w-0">
      {checking ? (
        <Text size="body" tone="muted" as="p">Checking…</Text>
      ) : percent === null ? (
        <Text size="body" tone="muted" as="p">Unavailable</Text>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-bakin-3">
            <p className="font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">{percent}%</p>
            <Text size="meta" tone="muted" as="p">of budget</Text>
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
    </div>
  )
}

function LatestSessionDetails({ row, checking, unavailable }: {
  row: AgentPulseRow
  checking: boolean
  unavailable: boolean
}) {
  const session = row.latestSession
  const costLabel = session ? latestSessionCostLabel(session) : null
  return (
    <DrawerSection title="Latest session">
      {session ? (
        <div>
          <Grid layout="split" gap="dense">
            <div className="min-w-0">
              <Text weight="medium" className="break-words">{session.model}</Text>
              <Text size="meta" tone="muted" as="p">
                {plural(session.messages, 'message')} · {formatTokenCount(session.tokens.total)} tokens
              </Text>
            </div>
            <KeyValue
              layout="inline"
              aria-label={`${row.agent} latest-session tokens`}
              items={[
                { label: 'Input', value: formatTokenCount(session.tokens.input), numeric: true },
                { label: 'Output', value: formatTokenCount(session.tokens.output), numeric: true },
                { label: 'Cache read', value: formatTokenCount(session.tokens.cacheRead), numeric: true },
                { label: 'Cache write', value: formatTokenCount(session.tokens.cacheWrite), numeric: true },
              ]}
            />
          </Grid>
          {costLabel && (
            <Text size="meta" tone="muted" as="p" className="mt-bakin-2">{costLabel}</Text>
          )}
        </div>
      ) : checking ? (
        <Text size="body" tone="muted" as="p">Checking latest session…</Text>
      ) : unavailable ? (
        <Text size="body" tone="muted" as="p">Latest-session detail is unavailable.</Text>
      ) : (
        <Text size="body" tone="muted" as="p">No latest-session token breakdown is available.</Text>
      )}
      <Button variant="link" size="sm" className="mt-bakin-3"
        aria-label={`Open diagnostics for ${row.agent}`}
        render={<PluginLink to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`} />}>
        Open diagnostics <ArrowUpRight className="size-bakin-3" aria-hidden="true" />
      </Button>
    </DrawerSection>
  )
}

function TrackedWork({ row, checking }: { row: AgentPulseRow; checking: boolean }) {
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
  return checking ? (
    <Text size="body" tone="muted" as="p">Checking…</Text>
  ) : row.effort ? (
    <div className="min-w-0">
      <p className="font-bakin-typography-weight-medium text-bakin-text-primary">{plural(row.effort.runs, 'tracked run')}</p>
      <Text size="meta" tone="muted" as="p">
        {row.effort.windowTokens === null
          ? `Token totals unavailable${tokenCoverage ? ` · ${tokenCoverage}` : ''}`
          : `${formatTokenCount(row.effort.windowTokens)} tracked tokens`}
      </Text>
      <Text size="meta" tone="muted" as="p">
        {plural(row.effort.completions, 'task completion')}
        {costCoverage ? ` · cost ${costCoverage}` : ''}
      </Text>
    </div>
  ) : <Text size="body" tone="muted" as="p">Work evidence unavailable</Text>
}

function AgentIdentity({ row, pending, unavailable, liveNowStale }: {
  row: AgentPulseRow
  pending: AgentPulsePending
  unavailable: AgentPulsePending
  liveNowStale: boolean
}) {
  const flag = row.effort?.flags[0]
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
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-bakin-2">
          <Text weight="semibold">{row.agent}</Text>
          {row.liveRun
            ? liveNowStale
              ? <StatusBadge tone="neutral" size="xs">Last seen working</StatusBadge>
              : <StatusBadge tone="accent" size="xs">Working</StatusBadge>
            : pending.liveNow
              ? <StatusBadge tone="neutral" size="xs">Checking live state</StatusBadge>
              : unavailable.liveNow
                ? <StatusBadge tone="neutral" size="xs">Live state unavailable</StatusBadge>
                : liveNowStale
                  ? <StatusBadge tone="neutral" size="xs">Live state stale</StatusBadge>
              : null}
        </div>
        <p
          className={flag && !row.liveRun
            ? 'mt-bakin-1 line-clamp-2 text-bakin-typography-size-meta text-bakin-text-muted'
            : 'mt-bakin-1 truncate text-bakin-typography-size-meta text-bakin-text-muted'}
        >
          {activitySummary}
        </p>
        {row.liveRunCount > 1 && (
          <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-signal-accent">{plural(row.liveRunCount, 'concurrent run')}</p>
        )}
      </div>
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
  const [selectedAgent, setSelectedAgent] = useQueryState('healthAgent', '')
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
  const selectedRow = rows.find(row => row.agent === selectedAgent)
  const columns: ReadonlyArray<DataTableColumn<AgentPulseRow>> = [
    { key: 'agent', header: 'Agent', narrow: 'primary', sortable: true, sortValue: row => row.agent,
      cellClassName: 'whitespace-normal align-top',
      cell: row => <AgentIdentity row={row} pending={pending} unavailable={unavailable} liveNowStale={liveNowStale} /> },
    { key: 'review', header: 'Review', narrow: 'meta', sortable: true,
      // Stable ties retain the canonical live/usage ordering from the view model.
      sortValue: row => Number(row.reviewState !== 'review'),
      cellClassName: 'whitespace-normal align-top',
      cell: row => <ReviewStatus row={row} checking={pending.effort} /> },
    { key: 'usage', header: 'Usage & cost', narrow: 'label', sortable: true, sortValue: row => row.observedTokens,
      cellClassName: 'whitespace-normal align-top', cell: row => <UsageMetric row={row} pending={pending} /> },
    { key: 'work', header: 'Tracked work', narrow: 'label', sortable: true, sortValue: row => pending.effort ? null : row.effort?.runs,
      cellClassName: 'whitespace-normal align-top', cell: row => <TrackedWork row={row} checking={pending.effort} /> },
    { key: 'context', header: 'Startup context', narrow: 'label', sortable: true,
      sortValue: row => pending.context || pending.settings ? null : row.startupContextPercent,
      cellClassName: 'whitespace-normal align-top', cell: row => <ContextMetric row={row} checking={pending.context || pending.settings} /> },
    { key: 'actions', header: 'Actions', narrow: 'trailing', hideLabel: true, align: 'end', cellClassName: 'align-top',
      cell: row => <Button size="xs" variant="ghost" aria-label={`View ${row.agent} details`} aria-haspopup="dialog"
        onClick={() => setSelectedAgent(row.agent)}>Details <ChevronRight aria-hidden="true" /></Button> },
  ]
  const ordering = useHealthTableSort(rows, columns, 'agent_sort', 'review')

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
            <Text size="meta" tone="muted" as="p" className="tabular-nums">
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
            </Text>
        )}
      </CardHeader>
      <CardContent>
      <div className="space-y-bakin-3">
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
          <>
            <HealthTableSort label="Sort agent pulse" {...ordering} />
            <DataTable label="Agent pulse" rows={ordering.rows} columns={columns} rowKey={row => row.agent}
              sort={ordering.sort} onSortChange={ordering.onSortChange} collapseBelow="3xl" listVariant="separated" />
          </>
        )}
        {mixedEvidence && (
          <Text size="meta" tone="muted" as="p">
            Usage and tracked-work evidence came from separate refreshes.
          </Text>
        )}
        {rows.length > 0 && error && (
          <p role="status" className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
            <Activity className="size-bakin-3" aria-hidden="true" /> Some agent evidence is unavailable: {error}.
          </p>
        )}
      </div>
      </CardContent>
      <Drawer open={Boolean(selectedAgent)} onOpenChange={open => { if (!open) setSelectedAgent('') }}
        title={`${selectedAgent} details`} description="Latest-session evidence and agent diagnostics" storageKey="health-agent">
        {selectedRow ? <LatestSessionDetails row={selectedRow} checking={pending.latestSessions}
          unavailable={unavailable.latestSessions || failedLatestSessions.has(selectedRow.agent)} />
          : <Text tone="muted">{loading ? 'Loading agent evidence…' : 'This agent has no evidence in the selected period.'}</Text>}
      </Drawer>
    </Card>
  )
}
