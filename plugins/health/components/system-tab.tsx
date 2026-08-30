'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryState } from '@makinbakin/sdk/hooks'
import { Grid } from '@makinbakin/sdk/layout'
import { StatTile, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, Button, Text, Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'
import { Puzzle, RefreshCw, Search, Server, ShieldCheck } from 'lucide-react'
import { SystemSearchSection } from './system-search-section'
import { SystemInventory, type SystemInventoryHandle } from './system-inventory'
import { SystemWatchList } from './system-watch-list'
import { focusSystemElement } from './system-navigation'
import { HealthTabIntro } from './health-tab-intro'
import { useSystemData, type UseSystemDataResult } from '../hooks/use-system-data'
import type { SystemFinding } from '../lib/system-view-model'
import {
  buildSubsystemSummaries,
  searchEvidenceStale,
  type SubsystemSummary,
  type SummaryStatus,
} from '../lib/system-summary-view-model'

const SUMMARY_TONE: Record<SummaryStatus, StatusTone> = {
  healthy: 'success',
  watching: 'attention',
  attention: 'danger',
  unknown: 'neutral',
  neutral: 'accent',
}

const SUMMARY_ICON = {
  runtime: Server,
  search: Search,
  plugins: Puzzle,
  diagnostics: ShieldCheck,
}

export function SystemTab() {
  const [pluginSearch, setPluginSearch] = useQueryState('system_plugin', '')
  const data = useSystemData()
  return (
    <SystemTabView
      data={data}
      pluginSearch={pluginSearch}
      onPluginSearchChange={setPluginSearch}
    />
  )
}

/** Presentation-only seam retained so contract-heavy System states stay easy to test. */
export function SystemTabView({
  data,
  section,
  pluginSearch: controlledPluginSearch,
  onPluginSearchChange: controlledPluginSearchChange,
}: {
  data: UseSystemDataResult
  section?: string | null
  pluginSearch?: string
  onPluginSearchChange?: (value: string) => void
}) {
  const searchDetailRef = useRef<HTMLDivElement>(null)
  const inventoryRef = useRef<SystemInventoryHandle>(null)
  const pendingPluginReveal = useRef<string | null>(null)
  const [localPluginSearch, setLocalPluginSearch] = useState('')
  const pluginSearch = controlledPluginSearch ?? localPluginSearch
  const setPluginSearch = controlledPluginSearchChange ?? setLocalPluginSearch
  const summaries = useMemo(() => buildSubsystemSummaries(data), [data])
  const requestedSearch = section === 'search'
    || (section == null && typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('section') === 'search')
  const searchReadinessStale = data.report.data
    ? searchEvidenceStale(data.report.data.subsystems.search)
    : false
  const refreshing = data.live.refreshing
    || data.searchStatus.refreshing
    || data.searchTelemetry.refreshing
    || data.registry.refreshing
    || data.pluginManifest.refreshing
    || data.report.refreshing
  const reviewEvidenceFailed = Boolean(
    data.report.error
    || data.report.backgroundError
    || data.registry.error
    || data.registry.backgroundError
    || data.pluginManifest.error
    || data.pluginManifest.backgroundError,
  )
  const reviewEvidenceLoading = data.report.loading || data.registry.loading || data.pluginManifest.loading
  const reportEvidenceCurrent = Boolean(
    data.report.data && !data.report.stale && !data.report.error && !data.report.backgroundError,
  )
  const pluginEvidenceCurrent = Boolean(
    data.registry.data
    && data.pluginManifest.data
    && !data.registry.error
    && !data.registry.backgroundError
    && !data.pluginManifest.error
    && !data.pluginManifest.backgroundError,
  )
  const reviewEvidenceState = reviewEvidenceFailed
    ? 'incomplete'
    : reviewEvidenceLoading
      ? 'checking'
      : reportEvidenceCurrent && pluginEvidenceCurrent ? 'current' : 'incomplete'

  useEffect(() => {
    if (typeof window === 'undefined') return
    const requestedSection = section ?? new URLSearchParams(window.location.search).get('section')
    if (requestedSection === 'search' && searchDetailRef.current) focusSystemElement(searchDetailRef.current)
  }, [section])

  useEffect(() => {
    const pluginId = pendingPluginReveal.current
    if (!pluginId || pluginSearch) return
    pendingPluginReveal.current = null
    inventoryRef.current?.revealPlugin(pluginId)
  }, [pluginSearch])

  const revealSubsystem = (key: SubsystemSummary['key']): void => {
    if (key === 'search') {
      if (searchDetailRef.current) focusSystemElement(searchDetailRef.current)
      return
    }
    if (key === 'runtime') inventoryRef.current?.revealHost()
    else if (key === 'plugins') inventoryRef.current?.revealPlugins()
    else inventoryRef.current?.revealChecks()
  }

  const revealFinding = (finding: SystemFinding): void => {
    if (finding.kind === 'check') {
      inventoryRef.current?.revealCheck(finding.targetId)
      return
    }
    if (!pluginSearch) {
      inventoryRef.current?.revealPlugin(finding.targetId)
      return
    }
    pendingPluginReveal.current = finding.targetId
    setPluginSearch('')
  }

  return (
    <div className="@container/health-system space-y-bakin-6" data-testid="health-system-tab">
      <HealthTabIntro
        title="System"
        description="See whether Bakin can serve work, Search can be trusted, plugins are active, and health evidence is current."
        actions={(
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  size="sm"
                  variant="outline"
                  busy={refreshing}
                  onClick={() => void data.refreshSystemDetails()}
                />
              )}
            >
              <RefreshCw aria-hidden="true" />
              {refreshing ? 'Refreshing…' : 'Refresh live data'}
            </TooltipTrigger>
            <TooltipContent>Reload live system data without running a new health sweep</TooltipContent>
          </Tooltip>
        )}
      />

      <section aria-labelledby="system-subsystems-title">
        <div className="mb-bakin-2 flex items-end justify-between gap-bakin-3">
          <div>
            <h2 id="system-subsystems-title" className="text-bakin-typography-size-body">Platform pulse</h2>
            <Text size="meta" tone="muted" as="p">A stable snapshot of the services that keep Bakin usable.</Text>
          </div>
        </div>
        <Grid
          as="div"
          role="list"
          layout="quarters"
          gap="dense"
          data-testid="system-platform-pulse"
        >
          {summaries.map((summary) => {
            const tone = SUMMARY_TONE[summary.status]
            const Icon = SUMMARY_ICON[summary.key as keyof typeof SUMMARY_ICON]
            return (
              <article
                key={summary.key}
                role="listitem"
                data-subsystem={summary.key}
                className="min-w-0"
              >
                <StatTile
                  variant="surface"
                  className="h-full w-full"
                  icon={Icon}
                  label={summary.label}
                  valueTone={tone}
                  value={(
                    <span className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-2">
                      <span>{summary.headline}</span>
                      <StatusBadge variant="outline" tone={tone}>{summary.statusLabel}</StatusBadge>
                    </span>
                  )}
                  sub={(
                    <>
                      <span className="block font-bakin-typography-weight-medium text-bakin-text-primary">
                        {summary.fact}
                      </span>
                      <span className="mt-bakin-2 line-clamp-2 block min-h-bakin-8">
                        {summary.summary}
                      </span>
                    </>
                  )}
                  onClick={() => revealSubsystem(summary.key)}
                />
              </article>
            )
          })}
        </Grid>
      </section>

      {data.report.error && !data.report.data && (
        <Alert tone="danger">
          <AlertDescription>The canonical health report is unavailable: {data.report.error}</AlertDescription>
        </Alert>
      )}

      <SystemWatchList
        report={data.report.data}
        registry={data.registry.data}
        manifest={data.pluginManifest.data}
        evidenceState={reviewEvidenceState}
        reportCurrent={reportEvidenceCurrent}
        pluginInventoryCurrent={pluginEvidenceCurrent}
        onRevealFinding={revealFinding}
      />

      <div
        ref={searchDetailRef}
        tabIndex={-1}
        aria-label="Search subsystem detail"
        className="scroll-mt-bakin-4 outline-none focus-visible:rounded-bakin-surface focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
      >
        <SystemSearchSection
          readiness={data.report.data?.subsystems.search ?? null}
          readinessStale={searchReadinessStale}
          status={data.searchStatus.data}
          telemetry={data.searchTelemetry.data}
          loading={data.searchStatus.loading || data.searchTelemetry.loading}
          error={data.searchStatus.error ?? data.searchTelemetry.error}
          backgroundError={data.searchStatus.backgroundError ?? data.searchTelemetry.backgroundError}
          mutation={data.searchMutation}
          onReindex={data.reindexSearch}
          technicalDetailsOpen={requestedSearch}
        />
      </div>

      <SystemInventory
        ref={inventoryRef}
        report={data.report.data}
        live={data.live.data}
        registry={data.registry.data}
        manifest={data.pluginManifest.data}
        loading={data.registry.loading || data.pluginManifest.loading}
        checkingUpdates={data.pluginManifest.refreshing}
        error={data.registry.error ?? data.pluginManifest.error}
        backgroundError={data.registry.backgroundError ?? data.pluginManifest.backgroundError}
        pluginMutation={data.pluginMutation}
        pluginInventoryCurrent={pluginEvidenceCurrent}
        pluginSearch={pluginSearch}
        onPluginSearchChange={setPluginSearch}
        onCheckUpdates={data.checkPluginUpdates}
        onUpgrade={data.upgradePlugin}
      />
    </div>
  )
}
