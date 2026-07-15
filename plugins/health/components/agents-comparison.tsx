'use client'

import { EmptyState, ErrorState, PluginLink, SectionCard, StatusBadge } from '@makinbakin/sdk/components'
import { Skeleton } from '@makinbakin/sdk/ui'
import { Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentEffortData, AgentEffortRow } from '../types'
import { formatTokenCount } from '../lib/format'

interface AgentsComparisonProps {
  data: AgentEffortData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="flex min-w-0 items-baseline justify-between gap-3 @[56rem]/agents-comparison:block">
      <dt className="text-xs text-muted-foreground @[56rem]/agents-comparison:sr-only">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums @[56rem]/agents-comparison:text-left">{children}</dd>
    </dl>
  )
}

function UsageSummary({ row }: { row: AgentEffortRow }) {
  if (row.totalObservedTokens === null) {
    return (
      <>
        <p className="text-muted-foreground">Total unavailable</p>
        <p className="text-[11px] text-muted-foreground">{formatTokenCount(row.windowTokens)} tracked</p>
      </>
    )
  }

  const tracked = Math.min(row.totalObservedTokens, Math.max(0, row.windowTokens))
  const outside = Math.min(row.totalObservedTokens - tracked, Math.max(0, row.unattributedTokens ?? 0))
  const trackedPercent = row.totalObservedTokens > 0 ? (tracked / row.totalObservedTokens) * 100 : 0
  const outsidePercent = row.totalObservedTokens > 0 ? (outside / row.totalObservedTokens) * 100 : 0

  return (
    <>
      <p className="font-medium text-foreground">{formatTokenCount(row.totalObservedTokens)} total</p>
      {row.totalObservedTokens > 0 && (
        <div
          role="img"
          aria-label={`${Math.round(trackedPercent)}% tracked work and ${Math.round(outsidePercent)}% outside tracked work`}
          className="my-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface"
        >
          <span className="bg-primary" style={{ width: `${trackedPercent}%` }} />
          <span className="bg-warning" style={{ width: `${outsidePercent}%` }} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {formatTokenCount(tracked)} tracked · {formatTokenCount(outside)} outside
      </p>
    </>
  )
}

function AgentComparisonRow({ row }: { row: AgentEffortRow }) {
  return (
    <article
      data-agent-comparison-row
      data-compact-layout="stacked"
      className="grid min-w-0 grid-cols-1 gap-3 rounded-xl bg-foreground/[0.025] p-3 ring-1 ring-foreground/10 @[28rem]/agents-comparison:grid-cols-2 @[56rem]/agents-comparison:grid-cols-[minmax(9rem,1fr)_minmax(14rem,1.5fr)_minmax(12rem,1.25fr)_minmax(8rem,.7fr)] @[56rem]/agents-comparison:items-start @[56rem]/agents-comparison:gap-4"
    >
      <div className="min-w-0 @[28rem]/agents-comparison:col-span-2 @[56rem]/agents-comparison:col-span-1">
        <PluginLink
          to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
          className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.agent}
        </PluginLink>
      </div>
      <Metric label="Usage">
        <UsageSummary row={row} />
      </Metric>
      <Metric label="Work & results">
        <p>{row.runs === 0 ? 'No tracked runs' : `${row.completions} of ${row.runs} runs completed`}</p>
        {row.tokensPerCompletion !== null && (
          <p className="text-[11px] text-muted-foreground">
            {formatTokenCount(row.tokensPerCompletion)} tokens per completion
          </p>
        )}
      </Metric>
      <Metric label="Status">
        <StatusBadge tone={row.flags.length > 0 ? 'warning' : 'success'} variant="outline">
          {row.flags.length > 0 ? 'Needs review' : 'No issues'}
        </StatusBadge>
      </Metric>
    </article>
  )
}

/** One comparison surface for token attribution, work, outcomes, and flags. */
export function AgentsComparison({ data, loading, error, onRetry }: AgentsComparisonProps) {
  const rows = data?.agents ?? []

  return (
    <SectionCard
      title={<h3>Agent activity</h3>}
      icon={Scale}
      description="Usage, tracked work, and recorded results for this period."
      className="min-w-0"
    >
      <div className="@container/agents-comparison" data-testid="agents-comparison">
        {loading && !data ? (
          <div role="status" aria-label="Loading agent comparison" className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error && !data ? (
          <ErrorState title="Agent outcomes unavailable" message={error} retry={onRetry} className="py-8" />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="section"
            title="No agent work or transcript traffic was recorded in this window."
            description="Choose a longer window if you expected recent activity."
          />
        ) : (
          <div className="space-y-2">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(9rem,1fr)_minmax(14rem,1.5fr)_minmax(12rem,1.25fr)_minmax(8rem,.7fr)] gap-4 px-3 text-[11px] font-medium text-muted-foreground @[56rem]/agents-comparison:grid"
            >
              <span>Agent</span>
              <span>Usage</span>
              <span>Work &amp; results</span>
              <span>Status</span>
            </div>
            <div className="space-y-2">
              {rows.map((row) => <AgentComparisonRow key={row.agent} row={row} />)}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
