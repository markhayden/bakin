'use client'

import { useEffect, useState } from 'react'
import type { SearchReadiness, SearchStageStatus } from '@makinbakin/sdk/types'
import { DisclosurePanel, Grid, Panel } from '@makinbakin/sdk/layout'
import {
  DataTable,
  StatTile,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, Badge, Banner, Button, Text, type BannerTone } from '@makinbakin/sdk/ui'
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
  technicalDetailsOpen?: boolean
}

type SearchTone = StatusTone

type SearchIndexTable = SearchHealthData['tables'][number]

const STATUS_LABEL: Record<SearchStageStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
  not_applicable: 'Not applicable',
}

const STATUS_TONE: Record<SearchStageStatus, SearchTone> = {
  healthy: 'success',
  degraded: 'attention',
  unhealthy: 'danger',
  unknown: 'neutral',
  not_applicable: 'neutral',
}

const STATUS_SEGMENT: Record<SearchStageStatus, string> = {
  healthy: 'bg-bakin-action-primary-background',
  degraded: 'bg-bakin-signal-highlight',
  unhealthy: 'bg-bakin-signal-danger',
  unknown: 'bg-bakin-text-muted',
  not_applicable: 'bg-bakin-border-subtle',
}

function SearchStageBadge({ status }: { status: SearchStageStatus }) {
  return (
    <StatusBadge variant="outline" tone={STATUS_TONE[status]}>
      {STATUS_LABEL[status]}
    </StatusBadge>
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

function mutationTone(status: SystemMutationState['status']): BannerTone {
  if (status === 'error') return 'danger'
  if (status === 'success') return 'success'
  if (status === 'outcome-unknown') return 'attention'
  return 'info'
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
  const enrichmentUnavailable = telemetry?.enrichmentEvidence?.status === 'unavailable'
  const enrichmentNotConfigured = telemetry?.enrichmentEvidence?.status === 'not_configured'
  const [detailsOpen, setDetailsOpen] = useState(technicalDetailsOpen)

  useEffect(() => {
    if (technicalDetailsOpen) setDetailsOpen(true)
  }, [technicalDetailsOpen])

  const indexColumns: ReadonlyArray<DataTableColumn<SearchIndexTable>> = [
    {
      key: 'index',
      header: 'Index',
      cellClassName: 'whitespace-normal align-top',
      cell: (table) => (
        <>
          <div className="font-bakin-typography-family-mono font-bakin-typography-weight-medium text-bakin-text-primary">{table.logical}</div>
          <details className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
            <summary className="cursor-pointer">Technical identity</summary>
            <p className="mt-bakin-1 break-all font-bakin-typography-family-mono">{table.physical} · schema v{table.schemaVersion} · {table.pluginId}</p>
          </details>
        </>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cellClassName: 'whitespace-normal align-top',
      cell: (table) => {
        const erroredLegs = table.legs.filter((leg) => Boolean(leg.error))
        const stateLabel = table.state === 'migrating'
          ? `Migrating · ${table.phase ?? 'running'}`
          : table.healthy && erroredLegs.length === 0 ? 'Active' : 'Needs attention'
        const stateTone: SearchTone = table.state === 'migrating'
          ? 'attention'
          : table.healthy && erroredLegs.length === 0 ? 'success' : 'danger'
        return (
          <>
            <StatusBadge variant="outline" tone={stateTone}>{stateLabel}</StatusBadge>
            {erroredLegs.map((leg) => (
              <p key={leg.name} className="mt-bakin-1 max-w-48 text-bakin-typography-size-meta text-bakin-signal-danger">{leg.name}: {leg.error}</p>
            ))}
          </>
        )
      },
    },
    {
      key: 'documents',
      header: 'Documents',
      align: 'end',
      cellClassName: 'align-top',
      cell: (table) => <span className="font-bakin-typography-family-mono tabular-nums">{table.docCount ?? '—'}</span>,
    },
    {
      key: 'lastIndexed',
      header: 'Last indexed',
      cellClassName: 'align-top',
      cell: (table) => <span className="text-bakin-text-muted">{relativeEpoch(table.lastIndexedAt)}</span>,
    },
    {
      key: 'backlog',
      header: 'Backlog',
      cellClassName: 'align-top',
      cell: (table) => (
        <span className="text-bakin-text-muted">
          <span className="whitespace-nowrap">{table.journalPending} journal</span>
          <span className="mx-bakin-1">·</span>
          <span className="whitespace-nowrap">{legBacklog(table.legs)} enrich</span>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'end',
      cellClassName: 'align-top',
      cell: (table) => {
        const isPending = mutation.status === 'pending'
          && (mutation.target === table.logical || mutation.target === 'all')
        return (
          <Button
            size="xs"
            variant="outline"
            disabled={mutationLocked}
            onClick={() => void onReindex(table.logical)}
            aria-label={`Reindex ${table.logical}`}
          >
            {isPending ? 'Starting…' : 'Reindex'}
          </Button>
        )
      },
    },
  ]

  return (
    <section aria-labelledby="search-system-title" className="overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3 border-b border-bakin-border-subtle px-bakin-4 py-bakin-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-bakin-2">
            <h2 id="search-system-title">Search readiness</h2>
            <SearchStageBadge status={readinessStatus} />
          </div>
          <p className="mt-bakin-1 max-w-3xl text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
            {readinessStale
              ? 'Search evidence is stale. Run checks before relying on this status.'
              : readiness?.summary ?? 'Waiting for Search readiness evidence.'}
          </p>
        </div>
        {loading && !status && !telemetry && (
          <Text size="meta" tone="muted">Loading live Search data…</Text>
        )}
      </header>

      <div className="space-y-bakin-4 p-bakin-4">
        <div
          data-testid="search-readiness-pipeline"
          role="group"
          aria-label="Search readiness pipeline"
        >
          <div
            className="flex h-bakin-1 gap-bakin-1 overflow-hidden rounded-bakin-pill bg-bakin-border-subtle/30"
            role="img"
            aria-label={(readiness?.stages ?? []).map((stage) => `${stage.label}: ${STATUS_LABEL[readinessStale ? 'unknown' : stage.status]}`).join(', ') || 'Search stages unavailable'}
          >
            {(readiness?.stages ?? []).map((stage) => {
              const stageStatus: SearchStageStatus = readinessStale ? 'unknown' : stage.status
              return <span key={stage.key} className={`min-w-0 flex-1 ${STATUS_SEGMENT[stageStatus]}`} aria-hidden="true" />
            })}
          </div>
          <Grid as="ol" layout="quarters" gap="dense" className="m-0 mt-bakin-3 list-none p-0">
            {(readiness?.stages ?? []).map((stage) => {
              const stageStatus: SearchStageStatus = readinessStale ? 'unknown' : stage.status
              return (
                <li key={stage.key} role="listitem" className="min-w-0">
                  <StatTile
                    label={stage.label}
                    value={STATUS_LABEL[stageStatus]}
                    valueTone={STATUS_TONE[stageStatus]}
                    sub={readinessStale ? `Last reported: ${stage.summary}` : stage.summary}
                  />
                </li>
              )
            })}
            {!readiness && (
              <li role="listitem" className="col-span-full">
                <Banner
                  tone="info"
                  headingLevel={3}
                  title="Search stages unavailable"
                  description="Search stages will appear after health checks complete."
                />
              </li>
            )}
          </Grid>
        </div>

        <Grid layout="thirds" gap="dense" aria-label="Search operational signals">
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
              : telemetry?.enrichment
                ? 'Items queued'
                : loading
                  ? 'Checking enrichment…'
                  : enrichmentUnavailable
                    ? 'Enrichment telemetry unavailable'
                    : enrichmentNotConfigured
                      ? 'Enrichment is not configured'
                      : 'Coverage telemetry unavailable'}
          />
        </Grid>

        {(error || backgroundError) && (
          <Banner
            tone="attention"
            announce="polite"
            headingLevel={3}
            title="Some Search detail could not be refreshed"
            description={error ?? backgroundError}
          />
        )}

        <DisclosurePanel
          data-testid="search-technical-details"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          summary={(
            <span className="min-w-0">
              <span className="block text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">Index inventory &amp; repair</span>
              <span className="block text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">Physical indexes, migrations, backlogs, and reindex controls.</span>
            </span>
          )}
          summaryMeta={<Badge variant="secondary">{status ? `${status.tables.length} tables` : 'Unavailable'}</Badge>}
        >
          <div className="space-y-bakin-3">
            <div className="flex flex-wrap items-end justify-between gap-bakin-3">
              <div>
                <h3 id="search-indexes-title" className="font-bakin-typography-weight-medium">Indexes &amp; migrations</h3>
                <Text size="meta" tone="muted" as="p">Rebuilds keep the active index serving while its replacement catches up.</Text>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!status?.enabled || status?.engineReachable === false || mutationLocked}
                onClick={() => void onReindex()}
              >
                {pendingAll ? 'Starting reindex…' : 'Reindex all'}
              </Button>
            </div>

            {status?.enabled && status.engineReachable === false ? (
              <Alert tone="attention">
                <AlertDescription>
                  Search is enabled but the engine is not answering. Table state below comes from local records;
                  document counts and reindexing are unavailable until the engine is back.
                </AlertDescription>
              </Alert>
            ) : null}

            {!status?.enabled ? (
              <Alert tone="neutral">
                <AlertDescription>
                  {status ? 'Search is disabled; no index actions are available.' : 'Index status is unavailable.'}
                </AlertDescription>
              </Alert>
            ) : status.tables.length === 0 ? (
              <Alert tone="neutral">
                <AlertDescription>No Search tables are registered.</AlertDescription>
              </Alert>
            ) : (
              <Panel scroll aria-label="Search indexes" data-testid="search-index-table-scroll" padding="compact" className="max-h-96">
                <DataTable<SearchIndexTable>
                  label="Search indexes"
                  rows={status.tables}
                  rowKey={(table) => table.logical}
                  columns={indexColumns}
                  renderRow={() => null}
                  tableProps={{ className: 'min-w-[760px]' }}
                />
              </Panel>
            )}
          </div>
        </DisclosurePanel>

        {mutation.status !== 'idle' && mutation.message && (
          <Banner
            tone={mutationTone(mutation.status)}
            announce={mutation.status === 'error' ? 'assertive' : 'polite'}
            headingLevel={3}
            title="Search repair update"
            description={mutation.message}
          />
        )}
      </div>
    </section>
  )
}
