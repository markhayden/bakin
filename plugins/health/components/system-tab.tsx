'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchReadiness } from '@makinbakin/sdk/types'
import { Button } from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
import { Puzzle, RefreshCw, Search, Server, ShieldCheck } from 'lucide-react'
import { SystemSearchSection } from './system-search-section'
import { SystemInventory } from './system-inventory'
import { SystemWatchList } from './system-watch-list'
import { focusSystemElement } from './system-navigation'
import { HealthTabIntro } from './health-tab-intro'
import { useSystemData, type UseSystemDataResult } from '../hooks/use-system-data'
import { mergeSystemPlugins, presentSystemCheck } from '../lib/system-view-model'

type SummaryStatus = 'healthy' | 'watching' | 'attention' | 'unknown' | 'neutral'

interface SubsystemSummary {
  key: 'runtime' | 'search' | 'plugins' | 'diagnostics'
  label: string
  status: SummaryStatus
  statusLabel: string
  headline: string
  summary: string
  fact: string
}

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

function searchEvidenceStale(readiness: SearchReadiness, now: number = Date.now()): boolean {
  const expired = (value: string | null): boolean => {
    if (!value) return true
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) || parsed <= now
  }
  if (!readiness.observedAt || expired(readiness.staleAt)) return true
  const stageKeys = new Set(readiness.stages.map((stage) => stage.key))
  if ((['engine', 'queries', 'indexes', 'journal'] as const).some((key) => !stageKeys.has(key))) return true
  return readiness.stages.some((stage) => stage.status !== 'not_applicable'
    && (!stage.observedAt || expired(stage.staleAt)))
}

function searchSummary(data: UseSystemDataResult): SubsystemSummary {
  if (!data.report.data || searchEvidenceStale(data.report.data.subsystems.search)) {
    return {
      key: 'search', label: 'Search', status: 'unknown', statusLabel: 'Unable to verify',
      headline: 'Search unknown',
      summary: data.report.error ?? 'Canonical Search readiness is missing or stale.', fact: 'Run health checks',
    }
  }
  const search = data.report.data.subsystems.search
  if (search.status === 'healthy') {
    return {
      key: 'search', label: 'Search', status: 'healthy', statusLabel: 'Healthy', headline: 'Search healthy',
      summary: search.summary, fact: '4 of 4 stages ready',
    }
  }
  if (search.status === 'degraded' || search.status === 'unhealthy') {
    const problemStages = search.stages.filter((stage) => stage.status === 'degraded' || stage.status === 'unhealthy').length
    return {
      key: 'search', label: 'Search', status: search.status === 'unhealthy' ? 'attention' : 'watching',
      statusLabel: search.status === 'unhealthy' ? 'Unhealthy' : 'Degraded',
      headline: search.status === 'unhealthy' ? 'Search unhealthy' : 'Search degraded',
      summary: search.summary, fact: `${problemStages} ${problemStages === 1 ? 'stage' : 'stages'} affected`,
    }
  }
  return {
    key: 'search', label: 'Search', status: 'unknown', statusLabel: 'Unknown', headline: 'Search unknown',
    summary: search.summary, fact: 'Evidence incomplete',
  }
}

function subsystemSummaries(data: UseSystemDataResult): SubsystemSummary[] {
  const plugins = mergeSystemPlugins(data.registry.data, data.pluginManifest.data)
  const pluginIds = new Set(plugins.map((plugin) => plugin.id))
  const pluginInventoryPending = (data.registry.loading && !data.registry.data)
    || (data.pluginManifest.loading && !data.pluginManifest.data)
  const pluginInventoryError = data.registry.error
    ?? data.pluginManifest.error
    ?? data.registry.backgroundError
    ?? data.pluginManifest.backgroundError
  const failedPlugins = plugins.filter((plugin) => plugin.status === 'failed').length
  const unknownPlugins = plugins.filter((plugin) => plugin.status === 'unknown').length
  const updates = plugins.filter((plugin) => plugin.upgradeAvailable).length
  const sessions = data.live.data?.activeSessions?.reduce((total, row) => total + row.sessions, 0) ?? null
  const checks = data.report.data?.checks ?? []
  const registeredChecks = data.report.data?.summary.checks.registered ?? checks.length
  const completedChecks = data.report.data?.summary.checks.completed
    ?? checks.filter((check) => check.latestExecution.outcome === 'observed').length
  const unverified = checks.filter((check) => check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid').length
  const checkPresentations = checks.map((check) => presentSystemCheck(check))
  const reviewChecks = checkPresentations.filter((presentation) => presentation.concerning)
  const failedChecks = reviewChecks.filter((presentation) => presentation.tone === 'destructive').length

  let pluginSummary: SubsystemSummary
  if (pluginInventoryError) {
    const hasInventory = pluginIds.size > 0
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown',
      statusLabel: hasInventory ? 'Refresh failed' : 'Unable to verify',
      headline: 'Plugins unknown',
      summary: hasInventory
        ? `Showing the last loaded inventory; ${pluginInventoryError}`
        : pluginInventoryError,
      fact: hasInventory ? `${pluginIds.size} last loaded` : 'Inventory unavailable',
    }
  } else if (failedPlugins > 0) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'attention', statusLabel: 'Needs attention',
      headline: failedPlugins === 1 ? 'Plugin issue' : 'Plugin issues',
      summary: `${failedPlugins} ${failedPlugins === 1 ? 'plugin failed' : 'plugins failed'} to activate.`,
      fact: updates > 0 ? `${updates} updates available` : 'Activation failed',
    }
  } else if (pluginInventoryPending) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown', statusLabel: 'Checking',
      headline: 'Checking plugins',
      summary: 'Waiting for the installed plugin inventory.', fact: 'Loading inventory',
    }
  } else if (!data.registry.data || !data.pluginManifest.data) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown', statusLabel: 'Incomplete',
      headline: 'Plugins incomplete',
      summary: 'The installed plugin inventory is incomplete.', fact: `${pluginIds.size} discovered`,
    }
  } else if (unknownPlugins > 0) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown', statusLabel: 'Unable to verify',
      headline: 'Plugins unknown',
      summary: `${unknownPlugins} installed ${unknownPlugins === 1 ? 'plugin has' : 'plugins have'} no confirmed activation state.`,
      fact: `${pluginIds.size} discovered`,
    }
  } else {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: updates > 0 ? 'neutral' : 'healthy',
      statusLabel: updates > 0 ? 'Updates available' : 'Healthy',
      headline: updates > 0 ? 'Plugin updates' : 'Plugins available',
      summary: updates > 0 ? `${updates} ${updates === 1 ? 'plugin has' : 'plugins have'} an available update.` : 'All discovered plugins are active.',
      fact: `${pluginIds.size} discovered`,
    }
  }

  const liveRefreshError = data.live.backgroundError
    ?? (data.live.stale ? 'Current host status could not be confirmed.' : null)
  const runtimeSummary: SubsystemSummary = data.live.error && !data.live.data
    ? {
        key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Unable to verify',
        headline: 'Host unknown',
        summary: data.live.error, fact: 'Host unavailable',
      }
    : liveRefreshError && data.live.data
      ? {
          key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Refresh failed',
          headline: 'Host status unknown',
          summary: `Showing the last reported host status; ${liveRefreshError}`,
          fact: sessions === null ? 'Last session count unavailable' : `${sessions} last reported ${sessions === 1 ? 'session' : 'sessions'}`,
        }
    : data.live.data?.server
      ? {
          key: 'runtime', label: 'Bakin host', status: 'healthy', statusLabel: 'Online',
          headline: 'Host online',
          summary: `Host process ${data.live.data.server.pid} is serving on port ${data.live.data.server.port}.`,
          fact: sessions === null ? 'Session count unavailable' : `${sessions} connected ${sessions === 1 ? 'session' : 'sessions'}`,
        }
      : {
          key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Checking',
          headline: 'Checking host',
          summary: 'Waiting for current host process details.', fact: 'Loading runtime',
        }

  let diagnosticsSummary: SubsystemSummary
  if (!data.report.data) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Unable to verify',
      headline: 'Checks unknown',
      summary: data.report.error ?? 'Waiting for the canonical health report.', fact: 'No report',
    }
  } else if (unverified > 0) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Incomplete',
      headline: 'Checks incomplete',
      summary: `${unverified} ${unverified === 1 ? 'check could' : 'checks could'} not be verified.`, fact: `${registeredChecks} registered ${registeredChecks === 1 ? 'check' : 'checks'}`,
    }
  } else if (data.report.stale) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Refresh needed',
      headline: 'Checks need refresh',
      summary: 'Health-check evidence needs to be refreshed.', fact: `${completedChecks} last completed`,
    }
  } else if (reviewChecks.length > 0) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: failedChecks > 0 ? 'attention' : 'watching',
      statusLabel: failedChecks > 0 ? 'Needs attention' : 'Watching',
      headline: failedChecks > 0 ? 'Checks need attention' : 'Checks watching',
      summary: `${reviewChecks.length} ${reviewChecks.length === 1 ? 'check has' : 'checks have'} evidence worth reviewing.`,
      fact: `${completedChecks} completed ${completedChecks === 1 ? 'check' : 'checks'}`,
    }
  } else {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'healthy', statusLabel: 'Verified',
      headline: 'Checks verified',
      summary: 'All completed checks returned healthy evidence.', fact: `${completedChecks} completed ${completedChecks === 1 ? 'check' : 'checks'}`,
    }
  }

  return [runtimeSummary, searchSummary(data), pluginSummary, diagnosticsSummary]
}

export function SystemTab() {
  return <SystemTabView data={useSystemData()} />
}

/** Presentation-only seam retained so contract-heavy System states stay easy to test. */
export function SystemTabView({ data, section }: { data: UseSystemDataResult; section?: string | null }) {
  const searchDetailRef = useRef<HTMLDivElement>(null)
  const [pluginSearch, setPluginSearch] = useState('')
  const summaries = useMemo(() => subsystemSummaries(data), [data])
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

  const revealSubsystem = (key: SubsystemSummary['key']): void => {
    if (key === 'search') {
      if (searchDetailRef.current) focusSystemElement(searchDetailRef.current)
      return
    }

    const testId = key === 'runtime'
      ? 'bakin-host-details'
      : key === 'plugins'
        ? 'installed-features-details'
        : 'all-health-checks-details'
    const disclosure = document.querySelector<HTMLDetailsElement>(`[data-testid="${testId}"]`)
    if (!disclosure) return

    disclosure.open = true
    const summary = disclosure.querySelector<HTMLElement>('summary')
    if (summary) focusSystemElement(summary)
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
        onRevealPlugin={() => setPluginSearch('')}
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
