'use client'

import { useEffect, useState } from 'react'
import type { SearchReadiness, SearchStageStatus } from '@makinbakin/sdk/types'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { StatTile, StatusBadge as StatusBadgePrimitive, type StatusTone } from '@makinbakin/sdk/components'
import { Activity, ChevronRight, ListRestart, WandSparkles } from 'lucide-react'
import type { SearchHealthData, SearchTelemetryData } from '../types'
import type { SystemMutationState } from '../hooks/use-system-data'

export interface SystemSearchSectionProps {
  readiness: SearchReadiness | null
  readinessStale?: boolean
  status: SearchHealthData | null
  telemetry: SearchTelemetryData | null
  loading?: boolean
  error?: string | null
  backgroundError?: string | null
  mutation: SystemMutationState
  onReindex: (table?: string) => void | Promise<void>
  technicalDetailsOpen?: boolean
}

type SearchTone = StatusTone

const STATUS_LABEL: Record<SearchStageStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
  not_applicable: 'Not applicable',
}

const STATUS_TONE: Record<SearchStageStatus, SearchTone> = {
  healthy: 'success',
  degraded: 'warning',
  unhealthy: 'destructive',
  unknown: 'neutral',
  not_applicable: 'neutral',
}

const STATUS_SEGMENT: Record<SearchStageStatus, string> = {
  healthy: 'bg-success',
  degraded: 'bg-warning',
  unhealthy: 'bg-destructive',
  unknown: 'bg-muted-foreground/55',
  not_applicable: 'bg-muted-foreground/25',
}

function StatusBadge({ status }: { status: SearchStageStatus }) {
  return (
    <StatusBadgePrimitive variant="outline" tone={STATUS_TONE[status]}>
      {STATUS_LABEL[status]}
    </StatusBadgePrimitive>
  )
}

function relativeEpoch(epochMs: number | null): string {
  if (epochMs === null) return 'Never'
  const seconds = Math.max(0, Math.floor((Date.now() - epochMs) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function legBacklog(legs: Array<{ pending?: number }>): number {
  return legs.reduce((total, leg) => total + (leg.pending ?? 0), 0)
}

function mutationTone(status: SystemMutationState['status']): string {
  if (status === 'error') return 'border-destructive/25 bg-destructive/10 text-destructive'
  if (status === 'success') return 'border-success/25 bg-success/10 text-success'
  if (status === 'outcome-unknown') return 'border-warning/25 bg-warning/10 text-warning'
  return 'border-border bg-muted/40 text-muted-foreground'
}

/** Search trust stays visible; physical indexes and repair controls are opt-in evidence. */
export function SystemSearchSection({
  readiness,
  readinessStale = false,
  status,
  telemetry,
  loading = false,
  error = null,
  backgroundError = null,
  mutation,
  onReindex,
  technicalDetailsOpen = false,
}: SystemSearchSectionProps) {
  const readinessStatus: SearchStageStatus = readinessStale ? 'unknown' : (readiness?.status ?? 'unknown')
  const pendingAll = mutation.status === 'pending' && mutation.target === 'all'
  const mutationLocked = mutation.status === 'pending' || mutation.status === 'outcome-unknown'
  const oneHour = telemetry?.windows['1h']
  const coverage = telemetry?.enrichment?.coverage
  const [detailsOpen, setDetailsOpen] = useState(technicalDetailsOpen)

  useEffect(() => {
    if (technicalDetailsOpen) setDetailsOpen(true)
  }, [technicalDetailsOpen])

  return (
    <section aria-labelledby="search-system-title" className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="search-system-title" className="text-base font-semibold">Search readiness</h2>
            <StatusBadge status={readinessStatus} />
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {readinessStale
              ? 'Search evidence is stale. Run checks before relying on this status.'
              : readiness?.summary ?? 'Waiting for Search readiness evidence.'}
          </p>
        </div>
        {loading && !status && !telemetry && (
          <span className="text-xs text-muted-foreground">Loading live Search data…</span>
        )}
      </header>

      <div className="space-y-4 p-4">
        <div
          data-testid="search-readiness-pipeline"
          role="group"
          aria-label="Search readiness pipeline"
        >
          <div
            className="flex h-2 gap-1 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={(readiness?.stages ?? []).map((stage) => `${stage.label}: ${STATUS_LABEL[readinessStale ? 'unknown' : stage.status]}`).join(', ') || 'Search stages unavailable'}
          >
            {(readiness?.stages ?? []).map((stage) => {
              const stageStatus: SearchStageStatus = readinessStale ? 'unknown' : stage.status
              return <span key={stage.key} className={`min-w-0 flex-1 ${STATUS_SEGMENT[stageStatus]}`} aria-hidden="true" />
            })}
          </div>
          <ol className="mt-3 grid gap-2 @[34rem]/health-system:grid-cols-2 @[68rem]/health-system:grid-cols-4">
            {(readiness?.stages ?? []).map((stage) => {
              const stageStatus: SearchStageStatus = readinessStale ? 'unknown' : stage.status
              return (
                <li key={stage.key} role="listitem" className="min-w-0 rounded-lg bg-foreground/[0.025] px-3 py-2.5 ring-1 ring-foreground/10">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{stage.label}</span>
                    <StatusBadge status={stageStatus} />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {readinessStale ? `Last reported: ${stage.summary}` : stage.summary}
                  </p>
                </li>
              )
            })}
            {!readiness && (
              <li role="listitem" className="col-span-full rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Search stages will appear after health checks complete.
              </li>
            )}
          </ol>
        </div>

        <div className="grid gap-3 @[40rem]/health-system:grid-cols-3" aria-label="Search operational signals">
          <StatTile
            icon={Activity}
            label="Queries · 1h"
            value={oneHour?.query.count ?? '—'}
            sub={oneHour
              ? `${oneHour.query.errors} errors${oneHour.query.medianMs != null ? ` · ${Math.round(oneHour.query.medianMs)}ms median` : ''}`
              : loading ? 'Checking query traffic…' : 'Query telemetry unavailable'}
          />
          <StatTile
            icon={ListRestart}
            label="Journal backlog"
            value={telemetry?.outbox.pending ?? status?.outbox?.pending ?? '—'}
            sub={telemetry?.outbox || status?.outbox
              ? `${telemetry?.outbox.quarantined ?? status?.outbox?.quarantined ?? 0} quarantined`
              : loading ? 'Checking pending writes…' : 'Journal telemetry unavailable'}
          />
          <StatTile
            icon={WandSparkles}
            label="Enrichment coverage"
            value={coverage ? `${coverage.enriched}/${coverage.total}` : (telemetry?.enrichment?.depth ?? '—')}
            sub={coverage
              ? `${coverage.missing + coverage.stale} waiting · ${coverage.failed} failed`
              : telemetry?.enrichment ? 'Items queued' : loading ? 'Checking enrichment…' : 'Coverage telemetry unavailable'}
          />
        </div>

        {(error || backgroundError) && (
          <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
            Some Search detail could not be refreshed: {error ?? backgroundError}
          </div>
        )}

        <details
          data-testid="search-technical-details"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          className="group overflow-hidden rounded-lg border border-border"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 marker:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Index inventory &amp; repair</span>
              <span className="block text-xs text-muted-foreground">Physical indexes, migrations, backlogs, and reindex controls.</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">{status ? `${status.tables.length} tables` : 'Unavailable'}</Badge>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
            </span>
          </summary>

          <div className="space-y-3 border-t border-border p-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 id="search-indexes-title" className="font-medium">Indexes &amp; migrations</h3>
                <p className="text-xs text-muted-foreground">Rebuilds keep the active index serving while its replacement catches up.</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!status?.enabled || mutationLocked}
                onClick={() => void onReindex()}
              >
                {pendingAll ? 'Starting reindex…' : 'Reindex all'}
              </Button>
            </div>

            {!status?.enabled ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {status ? 'Search is disabled; no index actions are available.' : 'Index status is unavailable.'}
              </p>
            ) : status.tables.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">No Search tables are registered.</p>
            ) : (
              <div data-testid="search-index-table-scroll" className="max-h-96 overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Index</th>
                      <th scope="col" className="px-3 py-2 font-medium">State</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Documents</th>
                      <th scope="col" className="px-3 py-2 font-medium">Last indexed</th>
                      <th scope="col" className="px-3 py-2 font-medium">Backlog</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {status.tables.map((table) => {
                      const erroredLegs = table.legs.filter((leg) => Boolean(leg.error))
                      const pending = legBacklog(table.legs)
                      const isPending = mutation.status === 'pending'
                        && (mutation.target === table.logical || mutation.target === 'all')
                      const stateLabel = table.state === 'migrating'
                        ? `Migrating · ${table.phase ?? 'running'}`
                        : table.healthy && erroredLegs.length === 0 ? 'Active' : 'Needs attention'
                      const stateTone: SearchTone = table.state === 'migrating'
                        ? 'warning'
                        : table.healthy && erroredLegs.length === 0 ? 'success' : 'destructive'
                      return (
                        <tr key={table.logical} className="align-top">
                          <td className="px-3 py-2.5">
                            <div className="font-mono font-medium text-foreground">{table.logical}</div>
                            <details className="mt-1 text-[10px] text-muted-foreground">
                              <summary className="cursor-pointer">Technical identity</summary>
                              <p className="mt-1 break-all font-mono">{table.physical} · schema v{table.schemaVersion} · {table.pluginId}</p>
                            </details>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadgePrimitive variant="outline" tone={stateTone}>{stateLabel}</StatusBadgePrimitive>
                            {erroredLegs.map((leg) => (
                              <p key={leg.name} className="mt-1 max-w-48 text-[10px] text-destructive">{leg.name}: {leg.error}</p>
                            ))}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{table.docCount ?? '—'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{relativeEpoch(table.lastIndexedAt)}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            <span className="whitespace-nowrap">{table.journalPending} journal</span>
                            <span className="mx-1">·</span>
                            <span className="whitespace-nowrap">{pending} enrich</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={mutationLocked}
                              onClick={() => void onReindex(table.logical)}
                              aria-label={`Reindex ${table.logical}`}
                            >
                              {isPending ? 'Starting…' : 'Reindex'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>

        {mutation.status !== 'idle' && mutation.message && (
          <div
            role={mutation.status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`rounded-lg border px-3 py-2 text-sm ${mutationTone(mutation.status)}`}
          >
            {mutation.message}
          </div>
        )}
      </div>
    </section>
  )
}
