'use client'

import { formatAbsoluteTime, formatRelativeTime } from '@makinbakin/sdk/conversation'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { Banner, Button, Skeleton } from '@makinbakin/sdk/ui'
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
    panel: 'border-bakin-border-subtle bg-bakin-surface-default',
    icon: 'bg-bakin-border-subtle/20 text-bakin-text-muted',
    text: 'text-bakin-text-primary',
    badge: 'neutral',
  },
  success: {
    panel: 'border-bakin-action-primary-background/60 bg-bakin-action-primary-background/10',
    icon: 'bg-bakin-action-primary-background/15 text-bakin-action-primary-background',
    text: 'text-bakin-action-primary-background',
    badge: 'success',
  },
  warning: {
    panel: 'border-bakin-signal-highlight/60 bg-bakin-signal-highlight/10',
    icon: 'bg-bakin-signal-highlight/15 text-bakin-signal-highlight',
    text: 'text-bakin-signal-highlight',
    badge: 'attention',
  },
  destructive: {
    panel: 'border-bakin-signal-danger/60 bg-bakin-signal-danger/10',
    icon: 'bg-bakin-signal-danger/15 text-bakin-signal-danger',
    text: 'text-bakin-signal-danger',
    badge: 'danger',
  },
} satisfies Record<OverviewTone, {
  panel: string
  icon: string
  text: string
  badge: StatusTone
}>

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
  const pulseDescription = error
    ? 'Health evidence could not be verified. Retry before acting on this snapshot.'
    : primaryCount > 0
      ? `${primaryLabel} ${primaryCount === 1 ? 'needs' : 'need'} attention. Resolve the affected conditions before relying on that work.`
      : 'No current conditions require action. Supporting evidence and recent activity remain available below.'

  return (
    <section
      aria-labelledby="overview-platform-pulse-title"
      data-layout="priority-signal"
      data-testid="overview-platform-pulse"
      className="flex min-w-0 flex-col gap-bakin-6"
    >
      <div
        className={`flex min-w-0 flex-wrap items-end justify-between gap-bakin-6 rounded-bakin-surface border p-bakin-6 ${TONE[overallTone].panel}`}
      >
        <div className="grid min-w-0 max-w-[64ch] grid-cols-[auto_minmax(0,1fr)] items-start gap-x-bakin-4 gap-y-bakin-2">
          <span className={`row-span-3 flex size-10 shrink-0 items-center justify-center rounded-bakin-pill ${TONE[overallTone].icon}`}>
            <OverallIcon className="size-bakin-4" aria-hidden="true" />
          </span>
          <p className="m-0 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-[0.12em] text-bakin-text-primary">
            Bakin · platform pulse
          </p>
          <h2
            id="overview-platform-pulse-title"
            className={`m-0 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold leading-tight ${TONE[overallTone].text}`}
          >
            {loading && !error
              ? (
                  <>
                    <span className="sr-only">Checking health</span>
                    <Skeleton className="h-bakin-6 w-40" aria-hidden="true" />
                  </>
                )
              : overallLabel}
          </h2>
          <p className="m-0 leading-relaxed text-bakin-text-muted">{pulseDescription}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-bakin-3">
          {!loading ? (
            <StatusBadge tone={TONE[overallTone].badge} variant="solid">
              {primaryCount > 0 ? primaryLabel : overallLabel}
            </StatusBadge>
          ) : null}
          <span className="flex items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            {checking
              ? <Clock3 className="size-bakin-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Clock3 className="size-bakin-3" aria-hidden="true" />}
            <span className="font-bakin-typography-weight-medium text-bakin-text-primary">Checked</span>
            {model.evidenceObservedAt
              ? (
                  <time dateTime={model.evidenceObservedAt} title={formatAbsoluteTime(model.evidenceObservedAt)}>
                    {relativeObservedAt(model.evidenceObservedAt)}
                  </time>
                )
              : <span>not yet</span>}
          </span>
        </div>
      </div>

      <div
        role="group"
        aria-label="Health summary metrics"
        className="grid min-w-0 grid-cols-1 border-y border-bakin-border-subtle @md/health:grid-cols-3"
      >
        <PluginLink
          to="/health?tab=system&section=search"
          aria-label={`Search: ${model.search.statusLabel}`}
          data-slot="health-summary-metric"
          className="group flex min-w-0 items-center gap-bakin-3 border-b border-bakin-border-subtle px-bakin-4 py-bakin-4 transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:bg-bakin-surface-default focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring @md/health:border-b-0"
        >
          <Search className={`size-bakin-4 shrink-0 ${TONE[model.search.tone].text}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-meta text-bakin-text-muted">Search</span>
            <span className={`block font-bakin-typography-weight-semibold ${TONE[model.search.tone].text}`}>{model.search.statusLabel}</span>
          </span>
          <ChevronRight className="ml-auto size-bakin-3 text-bakin-text-muted transition-transform duration-[var(--bakin-motion-duration-transition)] group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>

        <PluginLink
          to="/health?tab=agents"
          aria-label={`Agents: ${count(workingAgents, 'working')}, ${count(model.rightNow.connectedSessions, 'sessions')}`}
          data-slot="health-summary-metric"
          className="group flex min-w-0 items-center gap-bakin-3 border-b border-bakin-border-subtle px-bakin-4 py-bakin-4 transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:bg-bakin-surface-default focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring @md/health:border-b-0 @md/health:border-l"
        >
          <Bot
            className={model.rightNow.runningDispatches
              ? 'size-bakin-4 shrink-0 text-bakin-action-primary-background'
              : 'size-bakin-4 shrink-0 text-bakin-text-muted'}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-meta text-bakin-text-muted">Agents</span>
            <strong className="block whitespace-nowrap font-bakin-typography-weight-semibold text-bakin-text-primary">{count(workingAgents, 'working')}</strong>
            <span className="block whitespace-nowrap text-bakin-typography-size-meta text-bakin-text-muted">{count(model.rightNow.connectedSessions, 'sessions')}</span>
          </span>
          <ChevronRight className="ml-auto size-bakin-3 text-bakin-text-muted transition-transform duration-[var(--bakin-motion-duration-transition)] group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>

        <PluginLink
          to="/health?tab=activity&activity_window=1h#activity-needs-attention"
          aria-label={`Recent failures: ${count(recentFailures, 'failed')}`}
          data-slot="health-summary-metric"
          className="group flex min-w-0 items-center gap-bakin-3 px-bakin-4 py-bakin-4 transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:bg-bakin-surface-default focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring @md/health:border-l @md/health:border-bakin-border-subtle"
        >
          <Activity className={`size-bakin-4 shrink-0 ${TONE[failureTone].text}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-meta text-bakin-text-muted">Failures · 1h</span>
            <strong className={`block whitespace-nowrap font-bakin-typography-weight-semibold ${TONE[failureTone].text}`}>{count(recentFailures, 'failed')}</strong>
          </span>
          <ChevronRight className="ml-auto size-bakin-3 text-bakin-text-muted transition-transform duration-[var(--bakin-motion-duration-transition)] group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </PluginLink>
      </div>

      {error && (
        <Banner
          announce="assertive"
          tone="danger"
          title="Platform pulse couldn't load"
          description={error}
          action={onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button> : undefined}
        />
      )}
    </section>
  )
}
