'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import {
  EmptyState,
  formatAbsoluteTime,
  formatRelativeTime,
  SectionCard,
  StatTile,
  StatusBadge,
} from '@makinbakin/sdk/components'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Play,
  Search,
  Users,
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
  return (
    <section aria-labelledby={id}>
      <SectionCard
        title={<h2 id={id}>{title} ({incidents.length})</h2>}
        icon={icon}
        description={description}
        action={<StatusBadge tone={tone}>{incidents.length}</StatusBadge>}
      >
        <ul className="space-y-3">
          {incidents.map((item) => (
            <li key={item.incident.id}>
              <IncidentRow item={item} onRepair={onRepair} onRerun={onRerun} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </section>
  )
}

function EvidenceFreshness({ model }: { model: HealthOverviewViewModel }) {
  if (!model.evidenceObservedAt) return <span>No completed evidence yet</span>
  return (
    <span>
      Oldest evidence{' '}
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
  return (
    <section aria-labelledby="health-overall-title">
      <SectionCard
        title={<h2 id="health-overall-title">Overall health</h2>}
        icon={Activity}
        description="The current operator-facing state, based on the oldest required evidence."
        action={<StatusBadge tone={model.overallTone}>{model.overallLabel}</StatusBadge>}
      >
        {error ? (
          <div role="alert" className="rounded-lg bg-destructive/5 p-4 ring-1 ring-destructive/20">
            <p className="font-medium text-destructive">Health could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            {onRetry && <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
          </div>
        ) : loading ? (
          <div aria-busy="true" aria-label="Checking health" className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-lg font-semibold">{model.overallSummary}</p>
              <p className="mt-1 text-xs text-muted-foreground"><EvidenceFreshness model={model} /></p>
            </div>
            {checking && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Checking for newer evidence">
                <Clock3 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Checking for newer evidence…
              </span>
            )}
          </div>
        )}
      </SectionCard>
    </section>
  )
}

function SearchSection({ model }: { model: HealthOverviewViewModel }) {
  return (
    <section aria-labelledby="health-search-title">
      <SectionCard
        title={<h2 id="health-search-title">Search readiness</h2>}
        icon={Search}
        description="Production search is verified across its engine, query path, indexes, and write journal."
        action={<StatusBadge tone={model.search.tone}>{model.search.statusLabel}</StatusBadge>}
      >
        <p className="text-sm text-muted-foreground">{model.search.summary}</p>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Search readiness stages">
          {model.search.stages.map((stage) => (
            <li key={stage.key} className="rounded-lg bg-foreground/[0.03] p-3 ring-1 ring-foreground/10">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{stage.label}</h3>
                <StatusBadge tone={stage.tone} variant="outline">{stage.statusLabel}</StatusBadge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{stage.summary}</p>
              {stage.observedAt && (
                <time
                  className="mt-2 block text-[11px] text-muted-foreground/80"
                  dateTime={stage.observedAt}
                  title={formatAbsoluteTime(stage.observedAt)}
                >
                  Observed {relativeObservedAt(stage.observedAt)}
                </time>
              )}
            </li>
          ))}
        </ol>
      </SectionCard>
    </section>
  )
}

function factValue(value: number | null): string | number {
  return value ?? '—'
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

      {backgroundError && (
        <p className="rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
          Verified evidence remains visible, but some background data could not be refreshed: {backgroundError}
        </p>
      )}

      <SearchSection model={model} />

      <IncidentSection
        id="health-needs-action-title"
        title="Needs action"
        description="Known issues with a concrete operator action, ordered by severity and freshness."
        icon={AlertTriangle}
        incidents={model.needsAction}
        tone="destructive"
        onRepair={onRepair}
        onRerun={onRerun}
      />
      <IncidentSection
        id="health-unable-title"
        title="Unable to verify"
        description="Required checks whose evidence is missing, failed, invalid, or stale."
        icon={CircleHelp}
        incidents={model.unableToVerify}
        tone="neutral"
        onRepair={onRepair}
        onRerun={onRerun}
      />
      <IncidentSection
        id="health-watching-title"
        title="Watching"
        description="Fresh degraded conditions that may resolve without intervention."
        icon={Clock3}
        incidents={model.watching}
        tone="warning"
        onRepair={onRepair}
        onRerun={onRerun}
      />

      <section aria-labelledby="health-right-now-title">
        <SectionCard
          title={<h2 id="health-right-now-title">Right now</h2>}
          icon={Play}
          description="Live runtime facts, separate from the slower diagnostic evidence above."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              icon={Play}
              label="Running dispatches"
              value={factValue(model.rightNow.runningDispatches)}
              sub={model.rightNow.runningDispatches === null ? 'Live fact unavailable' : 'Currently in flight'}
            />
            <StatTile
              icon={Users}
              label="Connected runtime sessions"
              value={factValue(model.rightNow.connectedSessions)}
              sub={model.rightNow.connectedSessions === null ? 'Live fact unavailable' : 'Summed across agents'}
            />
            <StatTile
              icon={AlertTriangle}
              label="Recent failed events"
              value={factValue(model.rightNow.recentFailures)}
              sub={model.rightNow.recentFailures === null ? 'Live fact unavailable' : 'During the last hour'}
            />
          </div>
        </SectionCard>
      </section>

      {model.healthy && (
        <section aria-labelledby="health-all-clear-title">
          <SectionCard
            title={<h2 id="health-all-clear-title">All clear</h2>}
            icon={CheckCircle2}
            description="No action, verification, or watch incidents are active."
          >
            <EmptyState
              icon={CheckCircle2}
              title="All required checks are freshly verified."
              description="Bakin found no current conditions that need your attention."
              variant="section"
            />
          </SectionCard>
        </section>
      )}
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
