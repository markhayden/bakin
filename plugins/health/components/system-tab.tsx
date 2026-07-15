'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
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

const SUMMARY_STYLE: Record<SummaryStatus, { tone: StatusTone; accent: string; icon: string }> = {
  healthy: { tone: 'success', accent: 'bg-success', icon: 'text-success' },
  watching: { tone: 'warning', accent: 'bg-warning', icon: 'text-warning' },
  attention: { tone: 'destructive', accent: 'bg-destructive', icon: 'text-destructive' },
  unknown: { tone: 'neutral', accent: 'bg-muted-foreground', icon: 'text-muted-foreground' },
  neutral: { tone: 'accent', accent: 'bg-accent', icon: 'text-accent' },
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
    <div className="@container/health-system space-y-6" data-testid="health-system-tab">
      <HealthTabIntro
        title="System"
        description="See whether Bakin can serve work, Search can be trusted, plugins are active, and health evidence is current."
        actions={(
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void data.refreshSystemDetails()}
            title="Reload live system data without running a new health sweep"
          >
            <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh live data'}
          </Button>
        )}
      />

      <section aria-labelledby="system-subsystems-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 id="system-subsystems-title" className="text-base font-semibold">Platform pulse</h2>
            <p className="text-xs text-muted-foreground">A stable snapshot of the services that keep Bakin usable.</p>
          </div>
        </div>
        <div
          role="list"
          data-testid="system-platform-pulse"
          className="grid overflow-hidden rounded-xl border border-border/80 bg-border/70 @[36rem]/health-system:grid-cols-2 @[68rem]/health-system:grid-cols-4"
        >
          {summaries.map((summary) => {
            const style = SUMMARY_STYLE[summary.status]
            const Icon = SUMMARY_ICON[summary.key as keyof typeof SUMMARY_ICON]
            return (
              <article
                key={summary.key}
                role="listitem"
                data-subsystem={summary.key}
                className="relative min-w-0 bg-card"
              >
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 z-10 h-1 ${style.accent}`} />
                <button
                  type="button"
                  className="h-full w-full cursor-pointer px-4 py-3.5 text-left hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => revealSubsystem(summary.key)}
                  aria-label={`Open ${summary.label} detail: ${summary.headline}`}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Icon className={`size-4 shrink-0 ${style.icon}`} aria-hidden="true" />
                      <span className="truncate">{summary.label}</span>
                    </span>
                    <StatusBadge variant="outline" tone={style.tone}>{summary.statusLabel}</StatusBadge>
                  </span>
                  <span className="mt-3 block text-lg font-semibold tracking-tight text-foreground">{summary.headline}</span>
                  <span className="mt-1 block text-xs font-medium text-muted-foreground">{summary.fact}</span>
                  <span className="mt-3 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground/80">{summary.summary}</span>
                </button>
              </article>
            )
          })}
        </div>
      </section>

      {data.report.error && !data.report.data && (
        <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The canonical health report is unavailable: {data.report.error}
        </div>
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
        className="scroll-mt-4 outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
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
