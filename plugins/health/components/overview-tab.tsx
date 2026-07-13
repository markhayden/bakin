'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import {
  formatAbsoluteTime,
  formatRelativeTime,
  SectionCard,
  StatusBadge,
} from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import {
  Activity,
  AlertTriangle,
  CircleHelp,
  Clock3,
  Play,
  Search,
} from 'lucide-react'
import type { HealthOverviewViewModel, OverviewIncident } from '../lib/health-view-model'
import { useOverviewData, type UseOverviewDataResult } from '../hooks/use-overview-data'
import { IncidentRow } from './incident-row'

export interface OverviewTabViewProps {
  model: HealthOverviewViewModel
  loading?: boolean
  checking?: boolean
  error?: string | null
  backgroundError?: string | null
  onRetry?: () => void
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
}

interface IncidentSectionProps {
  id: string
  title: string
  description: string
  icon: typeof AlertTriangle
  incidents: OverviewIncident[]
  tone: 'neutral' | 'warning' | 'destructive'
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
}

function IncidentSection({
  id,
  title,
  description,
  icon,
  incidents,
  tone,
  onRepair,
  onRerun,
}: IncidentSectionProps) {
  if (incidents.length === 0) return null
  const Icon = icon

  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 id={id} className="text-lg font-semibold">{title} ({incidents.length})</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={tone}>{incidents.length}</StatusBadge>
      </div>
      <ul className="space-y-3">
        {incidents.map((item) => (
          <li key={item.incident.id}>
            <IncidentRow item={item} onRepair={onRepair} onRerun={onRerun} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EvidenceFreshness({ model }: { model: HealthOverviewViewModel }) {
  if (!model.evidenceObservedAt) return <span>No health check has completed yet</span>
  return (
    <span>
      Checked using evidence from{' '}
      <time dateTime={model.evidenceObservedAt} title={formatAbsoluteTime(model.evidenceObservedAt)}>
        {relativeObservedAt(model.evidenceObservedAt)}
      </time>
    </span>
  )
}

function relativeObservedAt(value: string): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return 'just now'
  return /^\d+[mhd]$/.test(relative) ? `${relative} ago` : relative
}

function OverallSection({
  model,
  loading,
  checking,
  error,
  onRetry,
}: Pick<OverviewTabViewProps, 'model' | 'loading' | 'checking' | 'error' | 'onRetry'>) {
  const toneClass = {
    neutral: 'border-border bg-card',
    success: 'border-success/30 bg-success/[0.04]',
    warning: 'border-warning/30 bg-warning/[0.04]',
    destructive: 'border-destructive/30 bg-destructive/[0.04]',
  }[model.overallTone]

  return (
    <section
      aria-labelledby="health-overall-title"
      role={error ? 'alert' : undefined}
      className={`rounded-xl border p-4 sm:p-5 ${toneClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="size-4" aria-hidden="true" />
            <h2 id="health-overall-title" className="text-sm font-semibold text-foreground">Overall health</h2>
          </div>
        {error ? (
          <div className="mt-3 max-w-3xl">
            <p className="text-xl font-semibold text-destructive">Health checks are unavailable.</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              Bakin can still show live activity, but it cannot verify system health right now.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              If this continues, restart the Bakin host, then run checks again.
            </p>
            {onRetry && <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
          </div>
        ) : loading ? (
          <div aria-busy="true" aria-label="Checking health" className="mt-3 space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xl font-semibold">{model.overallSummary}</p>
              <p className="mt-1 text-sm text-muted-foreground"><EvidenceFreshness model={model} /></p>
            </div>
            {checking && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Checking for newer evidence">
                <Clock3 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Checking for newer evidence…
              </span>
            )}
          </div>
        )}
        </div>
        <StatusBadge tone={error ? 'neutral' : model.overallTone}>
          {error ? 'Unable to verify' : model.overallLabel}
        </StatusBadge>
      </div>
    </section>
  )
}

function SearchSection({ model }: { model: HealthOverviewViewModel }) {
  const stageQuestions = {
    engine: 'Can Bakin reach the Search service?',
    queries: 'Can Bakin find existing information?',
    indexes: 'Is searchable information up to date?',
    journal: 'Can Bakin save new changes for Search?',
  } as const
  const hasKnownProblem = model.search.stages.some((stage) => (
    stage.tone === 'warning' || stage.tone === 'destructive'
  ))

  return (
    <section aria-labelledby="health-search-title">
      <SectionCard
        title={<h2 id="health-search-title">Search readiness</h2>}
        icon={Search}
        description="Can Bakin find existing information and save new changes? Search problems appear here even when the rest of Bakin works."
        action={<StatusBadge tone={model.search.tone}>{model.search.statusLabel}</StatusBadge>}
      >
        <p className="text-base font-medium text-foreground">{model.search.summary}</p>
        <details
          className="rounded-lg border border-border/70 bg-foreground/[0.02] px-3 py-2"
          open={hasKnownProblem || undefined}
        >
          <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            How Search was checked
          </summary>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Search readiness stages">
            {model.search.stages.map((stage) => (
              <li key={stage.key} className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{stage.label}</h3>
                  <StatusBadge tone={stage.tone} variant="outline">{stage.statusLabel}</StatusBadge>
                </div>
                <p className="mt-2 text-xs font-medium text-foreground">{stageQuestions[stage.key]}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.summary}</p>
                {stage.observedAt && (
                  <time
                    className="mt-2 block text-[11px] text-muted-foreground"
                    dateTime={stage.observedAt}
                    title={formatAbsoluteTime(stage.observedAt)}
                  >
                    Checked {relativeObservedAt(stage.observedAt)}
                  </time>
                )}
              </li>
            ))}
          </ol>
        </details>
      </SectionCard>
    </section>
  )
}

function liveCount(value: number | null, singular: string, plural: string): string {
  if (value === null) return `— ${plural}`
  return `${value} ${value === 1 ? singular : plural}`
}

export function OverviewTabView({
  model,
  loading = false,
  checking = false,
  error = null,
  backgroundError = null,
  onRetry,
  onRepair,
  onRerun,
}: OverviewTabViewProps) {
  return (
    <div className="space-y-5" data-testid="health-overview-tab">
      <OverallSection model={model} loading={loading} checking={checking} error={error} onRetry={onRetry} />

      {backgroundError && model.reportId && (
        <p className="rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
          Verified evidence remains visible, but some background data could not be refreshed: {backgroundError}
        </p>
      )}

      <SearchSection model={model} />

      <IncidentSection
        id="health-needs-action-title"
        title="Needs action"
        description="These problems need you. Start with the first item and follow its suggested action."
        icon={AlertTriangle}
        incidents={model.needsAction}
        tone="destructive"
        onRepair={onRepair}
        onRerun={onRerun}
      />
      <IncidentSection
        id="health-unable-title"
        title="Unable to verify"
        description="Bakin could not confirm whether these parts are working. Check again or follow the suggested step."
        icon={CircleHelp}
        incidents={model.unableToVerify}
        tone="neutral"
        onRepair={onRepair}
        onRerun={onRerun}
      />
      <IncidentSection
        id="health-watching-title"
        title="Watching"
        description="Nothing is broken yet, but these conditions may need you if they continue."
        icon={Clock3}
        incidents={model.watching}
        tone="warning"
        onRepair={onRepair}
        onRerun={onRerun}
      />

      <section aria-labelledby="health-right-now-title">
        <div className="rounded-xl border border-border/70 bg-foreground/[0.02] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Play className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 id="health-right-now-title" className="font-semibold">Right now</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Live activity for context. These numbers do not change the health verdict above.
              </p>
            </div>
            <a
              href="/health?tab=activity"
              className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View activity
            </a>
          </div>
          <p className="mt-3 text-sm font-medium tabular-nums text-foreground">
            {liveCount(model.rightNow.runningDispatches, 'running', 'running')} ·{' '}
            {liveCount(model.rightNow.connectedSessions, 'session', 'sessions')} ·{' '}
            {liveCount(model.rightNow.recentFailures, 'failed event', 'failed events')} in the last hour
          </p>
        </div>
      </section>
    </div>
  )
}

export interface OverviewTabProps {
  /** Allows the page shell to share one report hook with its Run checks action. */
  data?: UseOverviewDataResult
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
}

function ConnectedOverviewTab({
  data,
  onRepair,
  onRerun,
}: Required<Pick<OverviewTabProps, 'data'>> & Omit<OverviewTabProps, 'data'>) {
  return (
    <OverviewTabView
      model={data.model}
      loading={data.loading}
      checking={data.report.refreshing}
      error={data.error}
      backgroundError={data.backgroundError}
      onRetry={() => { void data.refresh() }}
      onRepair={onRepair}
      onRerun={onRerun ?? (() => { void data.runChecks() })}
    />
  )
}

function OwnedOverviewTab(props: Omit<OverviewTabProps, 'data'>) {
  const data = useOverviewData()
  return <ConnectedOverviewTab data={data} {...props} />
}

export function OverviewTab({ data, ...props }: OverviewTabProps) {
  return data ? <ConnectedOverviewTab data={data} {...props} /> : <OwnedOverviewTab {...props} />
}
