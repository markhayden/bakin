'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { EmptyState, ErrorState, SectionCard, SegmentedControl, StatTile } from '@makinbakin/sdk/components'
import { Badge, Button, Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, Coins, MessagesSquare, RefreshCw } from 'lucide-react'
import type { AgentUsage } from '@makinbakin/sdk/types'
import type { MeteredSpendData, UsageHistoryData } from '../types'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'
import { useAgentsData, type AgentsWindow } from '../hooks/use-agents-data'
import { AgentsComparison } from './agents-comparison'
import { AgentsUsageChart } from './agents-usage-chart'

const WINDOWS: readonly AgentsWindow[] = ['24h', '7d', '30d']

function agentsWindow(value: string): AgentsWindow {
  return WINDOWS.includes(value as AgentsWindow) ? value as AgentsWindow : '24h'
}

function LatestSessionUsage({ usage, loading, error, onRetry }: {
  usage: AgentUsage[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const total = usage?.reduce((sum, row) => sum + row.tokens.total, 0) ?? 0

  return (
    <SectionCard
      title={<h3>Latest session token usage</h3>}
      icon={MessagesSquare}
      description="Cumulative token traffic recorded in each agent's newest transcript — not context-window occupancy."
      action={usage && usage.length > 0 ? <Badge variant="secondary">{formatTokenCount(total)} tokens</Badge> : undefined}
      className="min-w-0"
    >
      <div className="@container/latest-sessions" data-testid="latest-session-usage">
        {loading && !usage ? (
          <div role="status" aria-label="Loading latest session usage" className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error && !usage ? (
          <ErrorState title="Latest session usage unavailable" message={error} retry={onRetry} className="py-8" />
        ) : !usage || usage.length === 0 ? (
          <EmptyState
            variant="section"
            title="No latest transcript token traffic is available."
            description="This snapshot appears after the runtime reports at least one agent session."
          />
        ) : (
          <div className="space-y-2">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(10rem,1.3fr)_repeat(5,minmax(5rem,.7fr))] gap-4 px-3 text-[11px] font-medium text-muted-foreground @[48rem]/latest-sessions:grid"
            >
              <span>Agent</span><span>Input</span><span>Output</span><span>Cache read</span><span>Cache write</span><span>Total</span>
            </div>
            {[...usage].sort((a, b) => a.agent.localeCompare(b.agent)).map((row) => (
              <article
                key={`${row.agent}:${row.sessionId}`}
                className="grid grid-cols-2 gap-3 rounded-xl bg-foreground/[0.025] p-3 ring-1 ring-foreground/10 @[48rem]/latest-sessions:grid-cols-[minmax(10rem,1.3fr)_repeat(5,minmax(5rem,.7fr))] @[48rem]/latest-sessions:items-center @[48rem]/latest-sessions:gap-4"
              >
                <div className="col-span-2 min-w-0 @[48rem]/latest-sessions:col-span-1">
                  <p className="font-medium">{row.agent}</p>
                  <p className="truncate text-[11px] text-muted-foreground" title={row.model}>{row.model} · {row.messages} messages</p>
                </div>
                {([
                  ['Input', row.tokens.input],
                  ['Output', row.tokens.output],
                  ['Cache read', row.tokens.cacheRead],
                  ['Cache write', row.tokens.cacheWrite],
                  ['Total', row.tokens.total],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 @[48rem]/latest-sessions:block">
                    <span className="text-xs text-muted-foreground @[48rem]/latest-sessions:sr-only">{label}</span>
                    <span className="text-right text-sm font-medium tabular-nums @[48rem]/latest-sessions:text-left">{formatTokenCount(value)}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function SpendSummary({ history, spend, window, loading, error, onRetry }: {
  history: UsageHistoryData | null
  spend: MeteredSpendData | null
  window: AgentsWindow
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const reportedCost = history?.byAgent.reduce(
    (sum, row) => sum + (row.costUsdMicros ?? 0),
    0,
  ) ?? null
  const costedMessages = history?.byAgent.reduce((sum, row) => sum + row.costedMessages, 0) ?? 0
  const messageCount = history?.byAgent.reduce((sum, row) => sum + row.messageCount, 0) ?? 0

  return (
    <SectionCard
      title={<h3>Spend & budget</h3>}
      icon={Coins}
      description="Runtime-reported transcript cost and Bakin's budget-gated estimate are different scopes."
      className="min-w-0"
    >
      <div className="@container/spend-summary">
        {loading && !history && !spend ? (
          <div role="status" aria-label="Loading spend summary" className="grid gap-3 @[36rem]/spend-summary:grid-cols-2">
            <Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 @[36rem]/spend-summary:grid-cols-2">
              <StatTile
                label="Runtime-reported transcript cost"
                value={history && costedMessages > 0 && reportedCost !== null
                  ? formatRuntimeCost(reportedCost / 1_000_000)
                  : 'Unavailable'}
                sub={`selected ${window} · ${costedMessages} of ${messageCount} messages reported cost`}
              />
              <StatTile
                label="Bakin-attributed estimate"
                value={spend ? formatRuntimeCost(spend.totalUsdMicros / 1_000_000) : 'Unavailable'}
                sub="fixed 24h scope · used by budget caps"
              />
            </div>
            {error && !spend && (
              <p role="status" className="text-xs text-muted-foreground">
                The Bakin-attributed estimate could not be loaded: {error}. Detailed budget controls are still available in Models.
              </p>
            )}
            <a
              href="/models?tab=spend"
              className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Models → Spend <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            {!spend && error && (
              <Button variant="ghost" size="sm" onClick={onRetry}>Retry spend summary</Button>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function AgentsTab() {
  const [windowParam, setWindowParam] = useQueryState('agents_window', '24h')
  const window = agentsWindow(windowParam)
  const resources = useAgentsData(window)
  const backgroundErrors = [
    resources.history.backgroundError,
    resources.effort.backgroundError,
    resources.latestSessions.backgroundError,
    resources.spend.backgroundError,
  ].filter((message): message is string => Boolean(message))

  return (
    <div className="min-w-0 space-y-5" data-testid="health-agents-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Agents</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">See what agents consumed, what Bakin attributed to work, and whether that work produced outcomes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={WINDOWS.map((value) => ({ value, label: value }))}
            value={window}
            onValueChange={setWindowParam}
            ariaLabel="Agents window"
          />
          <Button variant="outline" size="sm" onClick={() => void resources.refresh()} disabled={resources.refreshing}>
            <RefreshCw className={resources.refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {backgroundErrors.length > 0 && (
        <p role="status" className="text-xs text-warning-foreground">
          Showing the last loaded agent data; {backgroundErrors.length === 1 ? backgroundErrors[0] : `${backgroundErrors.length} background refreshes failed`}.
        </p>
      )}

      <AgentsUsageChart
        data={resources.history.data}
        loading={resources.history.loading}
        error={resources.history.error}
        onRetry={() => void resources.history.refresh()}
      />
      <AgentsComparison
        data={resources.effort.data}
        loading={resources.effort.loading}
        error={resources.effort.error}
        onRetry={() => void resources.effort.refresh()}
      />
      <LatestSessionUsage
        usage={resources.latestSessions.data}
        loading={resources.latestSessions.loading}
        error={resources.latestSessions.error}
        onRetry={() => void resources.latestSessions.refresh()}
      />
      <SpendSummary
        history={resources.history.data}
        spend={resources.spend.data}
        window={window}
        loading={resources.history.loading || resources.spend.loading}
        error={resources.spend.error}
        onRetry={() => void resources.spend.refresh()}
      />
    </div>
  )
}
