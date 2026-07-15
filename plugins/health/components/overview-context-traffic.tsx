'use client'

import { formatAbsoluteTime, formatRelativeTime, PluginLink, StatusBadge } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
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
  const segments = [
    { key: 'input', label: 'Input', value: traffic.input, className: 'bg-chart-1' },
    { key: 'output', label: 'Output', value: traffic.output, className: 'bg-chart-2' },
    { key: 'cacheRead', label: 'Cache read', value: traffic.cacheRead, className: 'bg-success' },
    { key: 'cacheWrite', label: 'Cache write', value: traffic.cacheWrite, className: 'bg-warning' },
  ]

  return (
    <section className="min-w-0 p-4" data-testid="overview-context-traffic" aria-labelledby="overview-context-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 id="overview-context-title" className="font-semibold text-foreground">Context &amp; cache</h3>
        </div>
        <PluginLink
          to="/health?tab=agents"
          aria-label="View agent context details"
          className="rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </PluginLink>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden="true" /> Context budget
          </span>
          {context.loading ? (
            <Skeleton className="h-5 w-24" />
          ) : context.error ? (
            <StatusBadge tone="neutral">Unavailable</StatusBadge>
          ) : overBudget > 0 ? (
            <StatusBadge tone="warning">{overBudget} over budget</StatusBadge>
          ) : (
            <StatusBadge tone="success">Within budget</StatusBadge>
          )}
        </div>

        {context.loading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : context.error ? (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Startup context could not be checked.</span>
            {context.onRetry && <Button size="xs" variant="ghost" onClick={context.onRetry}>Retry</Button>}
          </div>
        ) : highest ? (
          <div className="mt-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-foreground">{highest.agentId}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatBytes(highest.estimatedMaxTaskBytes)} / {formatBytes(budget)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${highest.agentId} startup context uses ${percent}% of its budget`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, percent)}
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className={`block h-full rounded-full ${overBudget > 0 ? 'bg-warning' : percent >= 80 ? 'bg-warning' : 'bg-success'}`}
                style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>Highest startup estimate</span>
              <span>{contextAgents.length} {contextAgents.length === 1 ? 'agent' : 'agents'}</span>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">Waiting for startup-context estimates.</div>
        )}
      </div>

      <div className="mt-4 border-t border-border/70 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">Latest-session traffic</span>
          {cachePercent !== null && <strong className="text-sm font-semibold tabular-nums text-success">{cachePercent}% from cache</strong>}
        </div>

        {sessions.loading && !sessions.data ? (
          <Skeleton className="mt-2 h-12 w-full" />
        ) : sessions.error && !sessions.data ? (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Session traffic unavailable.</span>
            {sessions.onRetry && <Button size="xs" variant="ghost" onClick={sessions.onRetry}>Retry</Button>}
          </div>
        ) : totalTraffic === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">No latest-session traffic reported.</div>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Latest-session token mix: input ${traffic.input}, output ${traffic.output}, cache read ${traffic.cacheRead}, cache write ${traffic.cacheWrite}`}
              className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-foreground/10"
            >
              {segments.filter((segment) => segment.value > 0).map((segment) => (
                <span
                  key={segment.key}
                  className={segment.className}
                  style={{ width: `${(segment.value / totalTraffic) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {segments.filter((segment) => segment.value > 0).map((segment) => (
                <div key={segment.key} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={`size-1.5 rounded-full ${segment.className}`} aria-hidden="true" />
                    {segment.label}
                  </span>
                  <span className="tabular-nums text-foreground">{formatTokenCount(segment.value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
              {latestSessions.slice(0, 2).map((session) => {
                const evidenceAt = session.lastMessageAt ?? session.sessionStarted
                const verb = session.lastMessageAt ? 'Active' as const : 'Started' as const
                return (
                  <div key={`${session.agent}:${session.sessionId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 text-muted-foreground">
                      <span className="block truncate">{session.agent} · {session.model}</span>
                      <time className="block text-[10px]" dateTime={evidenceAt} title={formatAbsoluteTime(evidenceAt)}>
                        {sessionTimeLabel(evidenceAt, verb)}
                      </time>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-foreground">{formatTokenCount(session.tokens.total)}</span>
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
