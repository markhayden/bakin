'use client'

import type { SearchReadiness, SearchStageStatus } from '@makinbakin/sdk/types'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@makinbakin/sdk/ui'
import { StatTile, StatusBadge as StatusBadgePrimitive, type StatusTone } from '@makinbakin/sdk/components'
import { Activity, ListRestart, WandSparkles } from 'lucide-react'
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
  return 'border-border bg-muted/40 text-muted-foreground'
}

/**
 * Canonical Search readiness followed by the operational detail needed to
 * understand and repair indexes, the write journal, and enrichment.
 */
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
}: SystemSearchSectionProps) {
  const readinessStatus: SearchStageStatus = readinessStale ? 'unknown' : (readiness?.status ?? 'unknown')
  const pendingAll = mutation.status === 'pending' && mutation.target === 'all'
  const oneHour = telemetry?.windows['1h']
  const coverage = telemetry?.enrichment?.coverage

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Search</h2>
              <StatusBadge status={readinessStatus} />
            </div>
            <p className="mt-1 max-w-3xl text-sm font-normal text-muted-foreground">
              {readinessStale
                ? 'Search readiness is stale. Run checks before relying on this status.'
                : readiness?.summary ?? 'Waiting for canonical Search readiness.'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!status?.enabled || mutation.status === 'pending'}
            onClick={() => void onReindex()}
          >
            {pendingAll ? 'Starting reindex…' : 'Reindex all'}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <section aria-labelledby="search-readiness-stages">
          <h3 id="search-readiness-stages" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Readiness stages
          </h3>
          <div className="mt-2 grid gap-2 @[34rem]/health-system:grid-cols-2 @[68rem]/health-system:grid-cols-4">
            {(readiness?.stages ?? []).map((stage) => {
              const stageStatus: SearchStageStatus = readinessStale ? 'unknown' : stage.status
              return (
                <div key={stage.key} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{stage.label}</span>
                    <StatusBadge status={stageStatus} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {readinessStale ? `Last reported: ${stage.summary}` : stage.summary}
                  </p>
                </div>
              )
            })}
            {!readiness && (
              <p className="col-span-full rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Search stages will appear when the canonical health report loads.
              </p>
            )}
          </div>
        </section>

        {(error || backgroundError) && (
          <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
            Search technical detail could not be refreshed: {error ?? backgroundError}
          </div>
        )}

        {loading && !status ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Loading Search indexes and telemetry…
          </p>
        ) : (
          <>
            <section aria-labelledby="search-operational-signals">
              <h3 id="search-operational-signals" className="sr-only">Search operational signals</h3>
              <div className="grid gap-3 @[42rem]/health-system:grid-cols-3">
                <StatTile
                  icon={Activity}
                  label="Queries"
                  value={oneHour?.query.count ?? '—'}
                  sub={`Last hour · ${oneHour ? `${oneHour.query.errors} errors` : 'No telemetry'}${oneHour?.query.medianMs != null ? ` · ${Math.round(oneHour.query.medianMs)}ms median` : ''}`}
                />
                <StatTile
                  icon={ListRestart}
                  label="Journal"
                  value={telemetry?.outbox.pending ?? status?.outbox?.pending ?? '—'}
                  sub={`Pending writes · ${telemetry?.outbox.quarantined ?? status?.outbox?.quarantined ?? '—'} quarantined`}
                />
                <StatTile
                  icon={WandSparkles}
                  label="Enrichment"
                  value={coverage ? `${coverage.enriched}/${coverage.total}` : (telemetry?.enrichment?.depth ?? '—')}
                  sub={coverage
                    ? `${coverage.missing + coverage.stale} waiting · ${coverage.failed} failed`
                    : telemetry?.enrichment ? 'Items queued' : 'No coverage telemetry'}
                />
              </div>
            </section>

            <section aria-labelledby="search-indexes-title">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="search-indexes-title" className="font-medium">Indexes &amp; migrations</h3>
                  <p className="text-xs text-muted-foreground">
                    Blue/green rebuilds keep the active index serving while a replacement catches up.
                  </p>
                </div>
                <Badge variant="secondary">{status?.tables.length ?? 0} tables</Badge>
              </div>

              {!status?.enabled ? (
                <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  {status ? 'Search is disabled; no index actions are available.' : 'Index status is unavailable.'}
                </p>
              ) : status.tables.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  No Search tables are registered.
                </p>
              ) : (
                <div data-testid="search-index-table-scroll" className="mt-3 max-h-96 overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[980px] text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Logical index</th>
                        <th scope="col" className="px-3 py-2 font-medium">Owner</th>
                        <th scope="col" className="px-3 py-2 font-medium">State</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Documents</th>
                        <th scope="col" className="px-3 py-2 font-medium">Last indexed</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Journal</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Enrichment</th>
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
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{table.physical} · schema v{table.schemaVersion}</div>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{table.pluginId}</td>
                            <td className="px-3 py-2.5">
                              <StatusBadgePrimitive variant="outline" tone={stateTone}>{stateLabel}</StatusBadgePrimitive>
                              {erroredLegs.map((leg) => (
                                <p key={leg.name} className="mt-1 max-w-48 text-[10px] text-destructive">{leg.name}: {leg.error}</p>
                              ))}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{table.docCount ?? '—'}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{relativeEpoch(table.lastIndexedAt)}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{table.journalPending}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{pending}</td>
                            <td className="px-3 py-2.5 text-right">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={mutation.status === 'pending'}
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
            </section>
          </>
        )}

        {mutation.status !== 'idle' && mutation.message && (
          <div
            role={mutation.status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`rounded-lg border px-3 py-2 text-sm ${mutationTone(mutation.status)}`}
          >
            {mutation.message}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
