'use client'

import { EmptyState, ErrorState, SectionCard } from '@makinbakin/sdk/components'
import { Skeleton } from '@makinbakin/sdk/ui'
import { Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentEffortData, AgentEffortRow } from '../types'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'

interface AgentsComparisonProps {
  data: AgentEffortData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="flex min-w-0 items-baseline justify-between gap-3 @[64rem]/agents-comparison:block">
      <dt className="text-xs text-muted-foreground @[64rem]/agents-comparison:sr-only">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums @[64rem]/agents-comparison:text-left">{children}</dd>
    </dl>
  )
}

function AttributionBar({ row }: { row: AgentEffortRow }) {
  if (row.totalObservedTokens === null || row.totalObservedTokens <= 0) return null
  const attributed = Math.min(row.totalObservedTokens, Math.max(0, row.windowTokens))
  const unattributed = Math.min(row.totalObservedTokens - attributed, Math.max(0, row.unattributedTokens ?? 0))
  const attributedPercent = (attributed / row.totalObservedTokens) * 100
  const unattributedPercent = (unattributed / row.totalObservedTokens) * 100

  return (
    <div
      role="img"
      aria-label={`${Math.round(attributedPercent)}% Bakin attributed and ${Math.round(unattributedPercent)}% unattributed`}
      className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface"
    >
      <span className="bg-primary" style={{ width: `${attributedPercent}%` }} />
      <span className="bg-warning" style={{ width: `${unattributedPercent}%` }} />
    </div>
  )
}

function AgentComparisonRow({ row }: { row: AgentEffortRow }) {
  return (
    <article
      data-agent-comparison-row
      data-compact-layout="stacked"
      className="grid min-w-0 grid-cols-1 gap-3 rounded-xl bg-foreground/[0.025] p-3 ring-1 ring-foreground/10 @[28rem]/agents-comparison:grid-cols-2 @[64rem]/agents-comparison:grid-cols-[minmax(9rem,1.25fr)_repeat(3,minmax(6rem,.8fr))_minmax(5rem,.6fr)_minmax(6rem,.7fr)_minmax(8rem,.9fr)_minmax(12rem,1.4fr)] @[64rem]/agents-comparison:items-start @[64rem]/agents-comparison:gap-4"
    >
      <div className="min-w-0 @[28rem]/agents-comparison:col-span-2 @[64rem]/agents-comparison:col-span-1">
        <a
          href={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
          className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.agent}
        </a>
        <AttributionBar row={row} />
      </div>
      <Metric label="Transcript observed">
        {row.totalObservedTokens === null ? <span className="text-muted-foreground">—</span> : formatTokenCount(row.totalObservedTokens)}
      </Metric>
      <Metric label="Bakin attributed">
        <span>{formatTokenCount(row.windowTokens)}</span>
        <span className="block text-[11px] text-muted-foreground">
          {row.windowCostUsdMicros === null ? 'estimate unavailable' : `Bakin est. ${formatRuntimeCost(row.windowCostUsdMicros / 1_000_000)}`}
        </span>
      </Metric>
      <Metric label="Unattributed">
        {row.unattributedTokens === null ? <span className="text-muted-foreground">—</span> : formatTokenCount(row.unattributedTokens)}
      </Metric>
      <Metric label="Runs">{row.runs}</Metric>
      <Metric label="Completions">{row.completions}</Metric>
      <Metric label="Outcome">
        {row.tokensPerCompletion === null
          ? <span className="text-muted-foreground">No recorded outcome</span>
          : `${formatTokenCount(row.tokensPerCompletion)} tokens / completion`}
      </Metric>
      <Metric label="Flags">
        {row.flags.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <ul className="space-y-1 text-left text-xs text-warning-foreground">
            {row.flags.map((flag) => (
              <li key={`${flag.kind}:${flag.message}`} className="rounded-md bg-warning/10 px-2 py-1">
                {flag.message}
              </li>
            ))}
          </ul>
        )}
      </Metric>
    </article>
  )
}

/** One comparison surface for token attribution, work, outcomes, and flags. */
export function AgentsComparison({ data, loading, error, onRetry }: AgentsComparisonProps) {
  const rows = data?.agents ?? []

  return (
    <SectionCard
      title={<h3>Usage & efficiency</h3>}
      icon={Scale}
      description="Compare transcript-observed traffic with Bakin-managed work and the outcomes each agent recorded."
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
              className="hidden grid-cols-[minmax(9rem,1.25fr)_repeat(3,minmax(6rem,.8fr))_minmax(5rem,.6fr)_minmax(6rem,.7fr)_minmax(8rem,.9fr)_minmax(12rem,1.4fr)] gap-4 px-3 text-[11px] font-medium text-muted-foreground @[64rem]/agents-comparison:grid"
            >
              <span>Agent</span>
              <span>Transcript observed</span>
              <span>Bakin attributed</span>
              <span>Unattributed</span>
              <span>Runs</span>
              <span>Completions</span>
              <span>Outcome</span>
              <span>Flags</span>
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
