'use client'

import { ErrorState, PluginLink, SectionCard } from '@makinbakin/sdk/components'
import { Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, CheckCircle2, CircleAlert } from 'lucide-react'
import type { AgentEffortData, AgentEffortFlag, AgentEffortRow } from '../types'
import { formatTokenCount } from '../lib/format'

interface AgentsAttentionProps {
  data: AgentEffortData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

function attentionMessage(row: AgentEffortRow, flag: AgentEffortFlag): string {
  if (flag.kind === 'effort-no-outcome') {
    if (row.runs === 0) return 'No tracked runs or completions were recorded.'
    return `${row.runs} tracked ${row.runs === 1 ? 'run produced' : 'runs produced'} no recorded completions.`
  }

  if (flag.kind === 'unattributed') {
    const outside = row.unattributedTokens ?? 0
    const percent = row.totalObservedTokens && row.totalObservedTokens > 0
      ? ` (${Math.round((outside / row.totalObservedTokens) * 100)}%)`
      : ''
    return `${formatTokenCount(outside)} tokens${percent} were outside tracked work.`
  }

  return `Token use is much higher than ${row.agent}'s recent baseline.`
}

/** Action-first list of agents whose usage or results deserve review. */
export function AgentsAttention({ data, loading, error, onRetry }: AgentsAttentionProps) {
  const flagged = data?.agents.filter((row) => row.flags.length > 0) ?? []

  return (
    <SectionCard
      title={<h3>Agents to review</h3>}
      icon={CircleAlert}
      description="Unexpected usage or work without recorded results."
      className="min-w-0"
    >
      <div data-testid="agents-attention">
        {loading && !data ? (
          <div role="status" aria-label="Loading agents to review" className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error && !data ? (
          <ErrorState title="Agent review unavailable" message={error} retry={onRetry} className="py-8" />
        ) : flagged.length === 0 ? (
          <p role="status" className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            No unusual agent usage detected.
          </p>
        ) : (
          <div className="space-y-2">
            {flagged.map((row) => (
              <article
                key={row.agent}
                className="flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{row.agent}</p>
                  <ul className="mt-1 space-y-1 text-sm text-warning">
                    {row.flags.map((flag) => (
                      <li key={`${flag.kind}:${flag.message}`}>{attentionMessage(row, flag)}</li>
                    ))}
                  </ul>
                </div>
                <PluginLink
                  to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
                  aria-label={`Review ${row.agent}'s recent sessions`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Review recent sessions <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </PluginLink>
              </article>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
