'use client'

import { PieChart } from '@makinbakin/sdk/charts'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Button, Progress, Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, Gauge, Layers3 } from 'lucide-react'
import { formatTokenCount } from '../lib/format'
import type { OverviewTelemetry } from './overview-telemetry'

const DEFAULT_CONTEXT_BUDGET = 64 * 1024

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function sessionTimeLabel(value: string, verb: 'Active' | 'Started'): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return `${verb} just now`
  return /^\d+[mhd]$/.test(relative) ? `${verb} ${relative} ago` : `${verb} ${relative}`
}

export function OverviewContextTraffic({
  context,
  sessions,
}: {
  context: OverviewTelemetry['context']
  sessions: OverviewTelemetry['sessions']
}) {
  const budgetReady = !context.loading && !context.error && context.data !== null
  const budget = context.budgetBytes && context.budgetBytes > 0
    ? context.budgetBytes
    : DEFAULT_CONTEXT_BUDGET
  const contextAgents = budgetReady ? [...(context.data?.agents ?? [])]
    .sort((left, right) => right.estimatedMaxTaskBytes - left.estimatedMaxTaskBytes)
    : []
  const highest = contextAgents[0] ?? null
  const overBudget = contextAgents.filter((agent) => agent.estimatedMaxTaskBytes > budget).length
  const percent = highest ? Math.round((highest.estimatedMaxTaskBytes / budget) * 100) : 0

  const latestSessions = [...(sessions.data ?? [])]
    .sort((left, right) => right.tokens.total - left.tokens.total || left.agent.localeCompare(right.agent))
  const traffic = latestSessions.reduce((total, session) => ({
    input: total.input + session.tokens.input,
    output: total.output + session.tokens.output,
    cacheRead: total.cacheRead + session.tokens.cacheRead,
    cacheWrite: total.cacheWrite + session.tokens.cacheWrite,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const totalTraffic = traffic.input + traffic.output + traffic.cacheRead + traffic.cacheWrite
  const promptTraffic = traffic.input + traffic.cacheRead + traffic.cacheWrite
  const cachePercent = promptTraffic > 0 ? Math.round((traffic.cacheRead / promptTraffic) * 100) : null
  const tokenMix = [
    { key: 'input', label: 'Input', value: traffic.input },
    { key: 'output', label: 'Output', value: traffic.output },
    { key: 'cacheRead', label: 'Cache read', value: traffic.cacheRead },
    { key: 'cacheWrite', label: 'Cache write', value: traffic.cacheWrite },
  ]

  return (
    <section className="min-w-0 p-bakin-4" data-testid="overview-context-traffic" aria-labelledby="overview-context-title">
      <div className="flex items-center justify-between gap-bakin-3">
        <div className="flex items-center gap-bakin-2">
          <Layers3 className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
          <h3 id="overview-context-title" className="font-bakin-typography-weight-semibold text-bakin-text-primary">Context &amp; cache</h3>
        </div>
        <PluginLink
          to="/health?tab=agents"
          aria-label="View agent context details"
          className="rounded-bakin-control text-bakin-signal-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
        >
          <ArrowUpRight className="size-bakin-4" aria-hidden="true" />
        </PluginLink>
      </div>

      <div className="mt-bakin-4">
        <div className="flex items-center justify-between gap-bakin-3">
          <span className="flex items-center gap-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
            <Gauge className="size-bakin-3" aria-hidden="true" /> Context budget
          </span>
          {context.loading ? (
            <Skeleton className="h-5 w-24" />
          ) : context.error ? (
            <StatusBadge tone="neutral">Unavailable</StatusBadge>
          ) : overBudget > 0 ? (
            <StatusBadge tone="attention">{overBudget} over budget</StatusBadge>
          ) : (
            <StatusBadge tone="success">Within budget</StatusBadge>
          )}
        </div>

        {context.loading ? (
          <Skeleton className="mt-bakin-2 h-10 w-full" />
        ) : context.error ? (
          <div className="mt-bakin-2 flex items-center justify-between gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            <span>Startup context could not be checked.</span>
            {context.onRetry && <Button size="xs" variant="ghost" onClick={context.onRetry}>Retry</Button>}
          </div>
        ) : highest ? (
          <div className="mt-bakin-2">
            <div className="flex items-baseline justify-between gap-bakin-3 text-bakin-typography-size-body">
              <span className="truncate font-bakin-typography-weight-medium text-bakin-text-primary">{highest.agentId}</span>
              <span className="shrink-0 tabular-nums text-bakin-text-muted">
                {formatBytes(highest.estimatedMaxTaskBytes)} / {formatBytes(budget)}
              </span>
            </div>
            <Progress
              className="mt-bakin-1"
              aria-label={`${highest.agentId} startup context uses ${percent}% of its budget`}
              value={Math.min(100, percent)}
              tone={overBudget > 0 || percent >= 80 ? 'attention' : 'primary'}
            />
            <div className="mt-bakin-1 flex justify-between text-bakin-typography-size-meta text-bakin-text-muted">
              <span>Highest startup estimate</span>
              <span>{contextAgents.length} {contextAgents.length === 1 ? 'agent' : 'agents'}</span>
            </div>
          </div>
        ) : (
          <div className="mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">Waiting for startup-context estimates.</div>
        )}
      </div>

      <div className="mt-bakin-4 border-t border-bakin-border-subtle pt-bakin-3">
        <div className="flex items-baseline justify-between gap-bakin-3">
          <span className="text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">Latest-session traffic</span>
          {cachePercent !== null && <strong className="text-bakin-typography-size-body font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">{cachePercent}% from cache</strong>}
        </div>

        {sessions.loading && !sessions.data ? (
          <Skeleton className="mt-bakin-2 h-12 w-full" />
        ) : sessions.error && !sessions.data ? (
          <div className="mt-bakin-2 flex items-center justify-between gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            <span>Session traffic unavailable.</span>
            {sessions.onRetry && <Button size="xs" variant="ghost" onClick={sessions.onRetry}>Retry</Button>}
          </div>
        ) : totalTraffic === 0 ? (
          <div className="mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">No latest-session traffic reported.</div>
        ) : (
          <>
            <div className="mt-bakin-2">
              <PieChart
                donut
                data={tokenMix}
                label="Latest-session token mix"
                formatValue={formatTokenCount}
                compactData
              />
            </div>
            <div className="mt-bakin-2 space-y-bakin-1 border-t border-bakin-border-subtle pt-bakin-2">
              {latestSessions.slice(0, 2).map((session) => {
                const evidenceAt = session.lastMessageAt ?? session.sessionStarted
                const verb = session.lastMessageAt ? 'Active' as const : 'Started' as const
                return (
                  <div key={`${session.agent}:${session.sessionId}`} className="flex items-center justify-between gap-bakin-3 text-bakin-typography-size-meta">
                    <span className="min-w-0 text-bakin-text-muted">
                      <span className="block truncate">{session.agent} · {session.model}</span>
                      <time className="block" dateTime={evidenceAt}>
                        {sessionTimeLabel(evidenceAt, verb)}
                      </time>
                    </span>
                    <span className="shrink-0 font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary">{formatTokenCount(session.tokens.total)}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
