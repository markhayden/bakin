'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { EmptyState, ErrorState, SectionCard, SegmentedControl } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, ChevronDown, MessagesSquare, RefreshCw } from 'lucide-react'
import type { AgentUsage } from '@makinbakin/sdk/types'
import type { UsageHistoryData } from '../types'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'
import { useAgentsData, type AgentsWindow } from '../hooks/use-agents-data'
import { AgentsAttention } from './agents-attention'
import { AgentsComparison } from './agents-comparison'
import { AgentsUsageChart } from './agents-usage-chart'

const WINDOWS: readonly AgentsWindow[] = ['24h', '7d', '30d']
const WINDOW_LABEL: Record<AgentsWindow, string> = {
  '24h': 'Today + yesterday',
  '7d': '8 calendar days',
  '30d': '31 calendar days',
}

function agentsWindow(value: string): AgentsWindow {
  return WINDOWS.includes(value as AgentsWindow) ? value as AgentsWindow : '24h'
}

function LatestSessionUsage({ usage, loading, error, onRetry }: {
  usage: AgentUsage[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <SectionCard
      title={<h3>Latest-session details</h3>}
      icon={MessagesSquare}
      description="Most recent session reported by each agent; independent of the selected period."
      className="min-w-0"
    >
      <div className="@container/latest-sessions" data-testid="latest-session-usage">
        {loading && !usage ? (
          <div role="status" aria-label="Loading latest-session details" className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error && !usage ? (
          <ErrorState title="Latest-session details unavailable" message={error} retry={onRetry} className="py-8" />
        ) : !usage || usage.length === 0 ? (
          <EmptyState
            variant="section"
            title="No latest transcript token traffic is available."
            description="This snapshot appears after the runtime reports at least one agent session."
          />
        ) : (
          <div className="space-y-2">
            {[...usage].sort((a, b) => a.agent.localeCompare(b.agent)).map((row) => (
              <details
                key={`${row.agent}:${row.sessionId}`}
                className="group rounded-xl bg-foreground/[0.025] ring-1 ring-foreground/10"
              >
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @[36rem]/latest-sessions:grid-cols-[minmax(10rem,1fr)_auto_auto] [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{row.agent}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={row.model}>
                      {row.model} · {row.messages} messages
                    </span>
                  </span>
                  <span className="text-sm font-medium tabular-nums text-foreground">{formatTokenCount(row.tokens.total)} tokens</span>
                  <span className="col-span-2 inline-flex items-center justify-end gap-1 text-xs text-muted-foreground @[36rem]/latest-sessions:col-span-1">
                    Breakdown
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </span>
                </summary>
                <dl
                  data-session-token-breakdown
                  className="grid grid-cols-2 gap-3 border-t border-foreground/10 px-3 py-3 @[36rem]/latest-sessions:grid-cols-4"
                >
                  {([
                    ['Input', row.tokens.input],
                    ['Output', row.tokens.output],
                    ['Cache read', row.tokens.cacheRead],
                    ['Cache write', row.tokens.cacheWrite],
                  ] as const).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-sm font-medium tabular-nums text-foreground">{formatTokenCount(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function ReportedCostSummary({ history, loading, error }: {
  history: UsageHistoryData | null
  loading: boolean
  error: string | null
}) {
  const reportedCost = history?.byAgent.reduce(
    (sum, row) => sum + (row.costUsdMicros ?? 0),
    0,
  ) ?? null
  const costedMessages = history?.byAgent.reduce((sum, row) => sum + row.costedMessages, 0) ?? 0
  const messageCount = history?.byAgent.reduce((sum, row) => sum + row.messageCount, 0) ?? 0

  return (
    <section
      data-testid="reported-cost-summary"
      aria-labelledby="reported-cost-title"
      className="flex flex-col gap-3 rounded-xl bg-foreground/[0.025] px-4 py-3 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h3 id="reported-cost-title" className="text-sm font-medium text-foreground">Reported cost</h3>
        {loading && !history ? (
          <div role="status" aria-label="Loading reported cost" className="mt-1 space-y-1">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        ) : error && !history ? (
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            Cost could not be checked because {error.charAt(0).toLowerCase()}{error.slice(1)}.
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {history && costedMessages > 0 && reportedCost !== null
                ? formatRuntimeCost(reportedCost / 1_000_000)
                : 'Unavailable'}
            </p>
            <p className="text-xs text-muted-foreground">
              {history
                ? `${costedMessages} of ${messageCount} messages from ${history.since} through ${history.throughDay} reported cost. Today is still being counted.`
                : 'Waiting for the selected calendar-day range.'}
            </p>
          </>
        )}
      </div>
      <a
        href="/models?tab=spend"
        className="inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        View budgets in Models <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </a>
    </section>
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
  ].filter((message): message is string => Boolean(message))

  return (
    <div className="min-w-0 space-y-5" data-testid="health-agents-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Agents</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">Find unusual token use or tracked work with few recorded results. Totals use calendar days; today is still in progress.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={WINDOWS.map((value) => ({ value, label: WINDOW_LABEL[value] }))}
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

      <AgentsAttention
        data={resources.effort.data}
        loading={resources.effort.loading}
        error={resources.effort.error}
        onRetry={() => void resources.effort.refresh()}
      />
      <AgentsComparison
        data={resources.effort.data}
        loading={resources.effort.loading}
        error={resources.effort.error}
        onRetry={() => void resources.effort.refresh()}
      />
      <AgentsUsageChart
        data={resources.history.data}
        loading={resources.history.loading}
        error={resources.history.error}
        onRetry={() => void resources.history.refresh()}
      />
      <LatestSessionUsage
        usage={resources.latestSessions.data}
        loading={resources.latestSessions.loading}
        error={resources.latestSessions.error}
        onRetry={() => void resources.latestSessions.refresh()}
      />
      <ReportedCostSummary
        history={resources.history.data}
        loading={resources.history.loading}
        error={resources.history.error}
      />
    </div>
  )
}
