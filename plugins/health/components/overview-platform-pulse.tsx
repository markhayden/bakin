'use client'

import { formatAbsoluteTime, formatRelativeTime, PluginLink, StatusBadge } from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Search,
} from 'lucide-react'
import type { HealthOverviewViewModel, OverviewTone } from '../lib/health-view-model'

interface OverviewPlatformPulseProps {
  model: HealthOverviewViewModel
  loading: boolean
  checking: boolean
  error: string | null
  onRetry?: () => void
}

const TONE = {
  neutral: {
    cell: 'bg-foreground/[0.02]',
    icon: 'bg-foreground/10 text-muted-foreground',
    text: 'text-muted-foreground',
  },
  success: {
    cell: 'bg-success/[0.045]',
    icon: 'bg-success/15 text-success',
    text: 'text-success',
  },
  warning: {
    cell: 'bg-warning/[0.055]',
    icon: 'bg-warning/15 text-warning',
    text: 'text-warning',
  },
  destructive: {
    cell: 'bg-destructive/[0.055]',
    icon: 'bg-destructive/15 text-destructive',
    text: 'text-destructive',
  },
} satisfies Record<OverviewTone, { cell: string; icon: string; text: string }>

function relativeObservedAt(value: string): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return 'just now'
  return /^\d+[mhd]$/.test(relative) ? `${relative} ago` : relative
}

function count(value: number | null, suffix: string): string {
  return value === null ? `— ${suffix}` : `${value.toLocaleString()} ${suffix}`
}

export function OverviewPlatformPulse({
  model,
  loading,
  checking,
  error,
  onRetry,
}: OverviewPlatformPulseProps) {
  const fixCount = model.needsAction.length
  const verifyCount = model.unableToVerify.length
  const primaryCount = fixCount + verifyCount
  const primaryLabel = [
    fixCount > 0 ? `${fixCount} ${fixCount === 1 ? 'fix' : 'fixes'}` : null,
    verifyCount > 0 ? `${verifyCount} verify` : null,
  ].filter(Boolean).join(' · ')
  const overallTone: OverviewTone = error ? 'neutral' : model.overallTone
  const overallLabel = error ? 'Unable to verify' : model.overallLabel
  const OverallIcon = overallTone === 'success' ? CheckCircle2 : AlertTriangle
  const recentFailures = model.rightNow.recentFailures
  const failureTone: OverviewTone = recentFailures === null
    ? 'neutral'
    : recentFailures > 0 ? 'destructive' : 'success'
  const workingAgents = model.rightNow.runningDispatches === null
    ? null
    : model.rightNow.runningAgents.length

  return (
    <section
      aria-labelledby="overview-platform-pulse-title"
      data-testid="overview-platform-pulse"
      className="overflow-hidden rounded-xl border border-border/80 bg-border/70"
    >
      <h2 id="overview-platform-pulse-title" className="sr-only">Platform pulse</h2>
      <div className="grid grid-cols-2 gap-px @[49rem]/health:grid-cols-[minmax(15rem,1.35fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(8rem,.8fr)_auto]">
        <div className={`col-span-2 flex min-h-20 items-center gap-3 px-4 py-3 @[49rem]/health:col-span-1 ${TONE[overallTone].cell}`}>
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${TONE[overallTone].icon}`}>
            <OverallIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bakin</span>
            {loading && !error
              ? <Skeleton className="mt-1 h-5 w-28" aria-label="Checking health" />
              : <strong className={`block text-base ${TONE[overallTone].text}`}>{overallLabel}</strong>}
          </span>
          {primaryCount > 0 && !loading && (
            <StatusBadge tone={model.needsAction.length > 0 ? 'destructive' : 'neutral'} className="ml-auto">
              {primaryLabel}
            </StatusBadge>
          )}
        </div>

        <PluginLink
          to="/health?tab=system&section=search"
          aria-label={`Search: ${model.search.statusLabel}`}
          className="group flex min-h-20 items-center gap-3 bg-card px-4 py-3 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Search className={`size-5 shrink-0 ${TONE[model.search.tone].text}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Search</span>
            <span className={`block font-semibold ${TONE[model.search.tone].text}`}>{model.search.statusLabel}</span>
          </span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>

        <PluginLink
          to="/health?tab=agents"
          aria-label={`Agents: ${count(workingAgents, 'working')}, ${count(model.rightNow.connectedSessions, 'sessions')}`}
          className="group flex min-h-20 items-center gap-3 bg-card px-4 py-3 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Bot className={model.rightNow.runningDispatches ? 'size-5 shrink-0 text-primary' : 'size-5 shrink-0 text-muted-foreground'} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Agents</span>
            <strong className="block whitespace-nowrap text-sm text-foreground">{count(workingAgents, 'working')}</strong>
            <span className="block whitespace-nowrap text-xs text-muted-foreground">{count(model.rightNow.connectedSessions, 'sessions')}</span>
          </span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>

        <PluginLink
          to="/health?tab=activity&activity_window=1h#activity-needs-attention"
          aria-label={`Recent failures: ${count(recentFailures, 'failed')}`}
          className="group flex min-h-20 items-center gap-3 bg-card px-4 py-3 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Activity className={`size-5 shrink-0 ${TONE[failureTone].text}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Failures · 1h</span>
            <strong className={`block whitespace-nowrap text-sm ${TONE[failureTone].text}`}>{count(recentFailures, 'failed')}</strong>
          </span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>

        <div className="flex min-h-20 items-center justify-center gap-2 bg-card px-4 py-3 text-xs text-muted-foreground">
          {checking ? <Clock3 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Clock3 className="size-3.5" aria-hidden="true" />}
          <span className="font-medium text-foreground">Checked</span>
          {model.evidenceObservedAt
            ? (
                <time dateTime={model.evidenceObservedAt} title={formatAbsoluteTime(model.evidenceObservedAt)}>
                  {relativeObservedAt(model.evidenceObservedAt)}
                </time>
              )
            : <span>not yet</span>}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-3 border-t border-destructive/25 bg-destructive/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-destructive">{error}</span>
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
        </div>
      )}
    </section>
  )
}
