'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { SearchReadiness } from '@makinbakin/sdk/types'
import { Button } from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
import { ChevronRight } from 'lucide-react'
import { SystemSearchSection } from './system-search-section'
import { SystemInventory } from './system-inventory'
import { HealthTabIntro } from './health-tab-intro'
import { useSystemData, type UseSystemDataResult } from '../hooks/use-system-data'

type SummaryStatus = 'healthy' | 'attention' | 'unknown' | 'neutral'

interface SubsystemSummary {
  key: string
  label: string
  status: SummaryStatus
  statusLabel: string
  summary: string
  fact: string
}

const SUMMARY_STYLE: Record<SummaryStatus, { tone: StatusTone; accent: string }> = {
  healthy: { tone: 'success', accent: 'bg-success' },
  attention: { tone: 'destructive', accent: 'bg-destructive' },
  unknown: { tone: 'neutral', accent: 'bg-muted-foreground' },
  neutral: { tone: 'accent', accent: 'bg-accent' },
}

const SUMMARY_QUESTION: Record<string, string> = {
  search: 'Can people find what they need?',
  plugins: 'Are installed features available?',
  diagnostics: 'Did every health check finish cleanly?',
  runtime: 'Is the Bakin host online?',
}

const SUMMARY_RANK: Record<SummaryStatus, number> = {
  attention: 0,
  unknown: 1,
  neutral: 2,
  healthy: 3,
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
      summary: data.report.error ?? 'Canonical Search readiness is missing or stale.', fact: 'Run health checks',
    }
  }
  const search = data.report.data.subsystems.search
  if (search.status === 'healthy') {
    return { key: 'search', label: 'Search', status: 'healthy', statusLabel: 'Healthy', summary: search.summary, fact: 'All stages ready' }
  }
  if (search.status === 'degraded' || search.status === 'unhealthy') {
    const problemStages = search.stages.filter((stage) => stage.status === 'degraded' || stage.status === 'unhealthy').length
    return {
      key: 'search', label: 'Search', status: 'attention',
      statusLabel: search.status === 'unhealthy' ? 'Unhealthy' : 'Degraded',
      summary: search.summary, fact: `${problemStages} ${problemStages === 1 ? 'stage' : 'stages'} affected`,
    }
  }
  return { key: 'search', label: 'Search', status: 'unknown', statusLabel: 'Unknown', summary: search.summary, fact: 'Evidence incomplete' }
}

function subsystemSummaries(data: UseSystemDataResult): SubsystemSummary[] {
  const plugins = data.registry.data?.plugins ?? []
  const manifests = data.pluginManifest.data?.plugins ?? []
  const pluginIds = new Set([...plugins.map((plugin) => plugin.id), ...manifests.map((plugin) => plugin.id)])
  const pluginInventoryPending = (data.registry.loading && !data.registry.data)
    || (data.pluginManifest.loading && !data.pluginManifest.data)
  const pluginInventoryError = data.registry.error
    ?? data.pluginManifest.error
    ?? data.registry.backgroundError
    ?? data.pluginManifest.backgroundError
  const failedIds = new Set([
    ...plugins.filter((plugin) => plugin.status === 'failed').map((plugin) => plugin.id),
    ...manifests.filter((plugin) => plugin.status === 'failed').map((plugin) => plugin.id),
  ])
  const failedPlugins = failedIds.size
  const updates = manifests.filter((plugin) => plugin.upgradeAvailable).length
  const sessions = data.live.data?.activeSessions?.reduce((total, row) => total + row.sessions, 0) ?? null
  const checks = data.report.data?.checks ?? []
  const registeredChecks = data.report.data?.summary.checks.registered ?? checks.length
  const completedChecks = data.report.data?.summary.checks.completed
    ?? checks.filter((check) => check.latestExecution.outcome === 'observed').length
  const unverified = checks.filter((check) => check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid').length
  const unhealthy = data.report.data?.observations.filter((observation) => observation.status !== 'healthy').length ?? 0

  let pluginSummary: SubsystemSummary
  if (failedPlugins > 0) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'attention', statusLabel: 'Needs attention',
      summary: `${failedPlugins} ${failedPlugins === 1 ? 'plugin failed' : 'plugins failed'} to activate.`,
      fact: updates > 0 ? `${updates} updates available` : 'Activation failed',
    }
  } else if (pluginInventoryError) {
    const hasInventory = pluginIds.size > 0
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown',
      statusLabel: hasInventory ? 'Refresh failed' : 'Unable to verify',
      summary: hasInventory
        ? `Showing the last loaded inventory; ${pluginInventoryError}`
        : pluginInventoryError,
      fact: hasInventory ? `${pluginIds.size} last loaded` : 'Inventory unavailable',
    }
  } else if (pluginInventoryPending) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown', statusLabel: 'Checking',
      summary: 'Waiting for the installed plugin inventory.', fact: 'Loading inventory',
    }
  } else if (!data.registry.data || !data.pluginManifest.data) {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: 'unknown', statusLabel: 'Incomplete',
      summary: 'The installed plugin inventory is incomplete.', fact: `${pluginIds.size} discovered`,
    }
  } else {
    pluginSummary = {
      key: 'plugins', label: 'Installed features', status: updates > 0 ? 'neutral' : 'healthy',
      statusLabel: updates > 0 ? 'Updates available' : 'Healthy',
      summary: updates > 0 ? `${updates} ${updates === 1 ? 'plugin has' : 'plugins have'} an available update.` : 'All discovered plugins are active.',
      fact: `${pluginIds.size} discovered`,
    }
  }

  const liveRefreshError = data.live.backgroundError
    ?? (data.live.stale ? 'Current host status could not be confirmed.' : null)
  const runtimeSummary: SubsystemSummary = data.live.error && !data.live.data
    ? {
        key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Unable to verify',
        summary: data.live.error, fact: 'Host unavailable',
      }
    : liveRefreshError && data.live.data
      ? {
          key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Refresh failed',
          summary: `Showing the last reported host status; ${liveRefreshError}`,
          fact: sessions === null ? 'Last session count unavailable' : `${sessions} last reported ${sessions === 1 ? 'session' : 'sessions'}`,
        }
    : data.live.data?.server
      ? {
          key: 'runtime', label: 'Bakin host', status: 'healthy', statusLabel: 'Online',
          summary: `Host process ${data.live.data.server.pid} is serving on port ${data.live.data.server.port}.`,
          fact: sessions === null ? 'Session count unavailable' : `${sessions} connected ${sessions === 1 ? 'session' : 'sessions'}`,
        }
      : {
          key: 'runtime', label: 'Bakin host', status: 'unknown', statusLabel: 'Checking',
          summary: 'Waiting for current host process details.', fact: 'Loading runtime',
        }

  let diagnosticsSummary: SubsystemSummary
  if (!data.report.data) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Unable to verify',
      summary: data.report.error ?? 'Waiting for the canonical health report.', fact: 'No report',
    }
  } else if (unverified > 0) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Incomplete',
      summary: `${unverified} ${unverified === 1 ? 'check could' : 'checks could'} not be verified.`, fact: `${registeredChecks} registered ${registeredChecks === 1 ? 'check' : 'checks'}`,
    }
  } else if (data.report.stale) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'unknown', statusLabel: 'Refresh needed',
      summary: 'Health-check evidence needs to be refreshed.', fact: `${completedChecks} last completed`,
    }
  } else if (unhealthy > 0) {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'attention', statusLabel: 'Findings',
      summary: `${unhealthy} non-healthy ${unhealthy === 1 ? 'observation needs' : 'observations need'} review.`, fact: `${completedChecks} completed ${completedChecks === 1 ? 'check' : 'checks'}`,
    }
  } else {
    diagnosticsSummary = {
      key: 'diagnostics', label: 'Health checks', status: 'healthy', statusLabel: 'Verified',
      summary: 'All completed checks returned healthy evidence.', fact: `${completedChecks} completed ${completedChecks === 1 ? 'check' : 'checks'}`,
    }
  }

  return [searchSummary(data), pluginSummary, runtimeSummary, diagnosticsSummary]
}

export function SystemTab() {
  return <SystemTabView data={useSystemData()} />
}

/** Presentation-only seam retained so contract-heavy System states stay easy to test. */
export function SystemTabView({ data, section }: { data: UseSystemDataResult; section?: string | null }) {
  const searchDetailRef = useRef<HTMLDivElement>(null)
  const searchDisclosureRef = useRef<HTMLDetailsElement>(null)
  const summaries = useMemo(() => subsystemSummaries(data)
    .map((summary, index) => ({ summary, index }))
    .sort((left, right) => SUMMARY_RANK[left.summary.status] - SUMMARY_RANK[right.summary.status] || left.index - right.index)
    .map(({ summary }) => summary), [data])
  const search = summaries.find((summary) => summary.key === 'search')!
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const requestedSection = section ?? new URLSearchParams(window.location.search).get('section')
    if (requestedSection === 'search') {
      if (searchDisclosureRef.current) searchDisclosureRef.current.open = true
      searchDetailRef.current?.focus()
    }
  }, [section])

  return (
    <div className="@container/health-system space-y-6" data-testid="health-system-tab">
      <HealthTabIntro
        title="System"
        description="Confirm Search, the runtime, installed plugins, and registered health checks are available and current. Start with anything that needs attention."
        actions={(
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void data.refreshSystemDetails()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh system details'}
          </Button>
        )}
      />

      <section aria-labelledby="system-subsystems-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 id="system-subsystems-title" className="text-base font-semibold">Subsystem status</h2>
            <p className="text-sm text-muted-foreground">The shortest path to what is unavailable or needs attention.</p>
          </div>
        </div>
        <div
          role="list"
          data-testid="system-subsystem-list"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          {summaries.map((summary) => {
            const style = SUMMARY_STYLE[summary.status]
            return (
              <article
                key={summary.key}
                role="listitem"
                className="grid gap-2 px-3 py-2.5 @[42rem]/health-system:grid-cols-[minmax(14rem,0.8fr)_minmax(18rem,1.4fr)_auto] @[42rem]/health-system:items-center"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${style.accent}`} />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{summary.label}</p>
                    <h3 className="text-sm font-medium">{SUMMARY_QUESTION[summary.key]}</h3>
                  </div>
                </div>
                <p className="text-sm leading-snug text-muted-foreground">{summary.summary}</p>
                <div className="flex flex-wrap items-center gap-2 @[42rem]/health-system:justify-end">
                  <StatusBadge variant="outline" tone={style.tone}>{summary.statusLabel}</StatusBadge>
                  <span className="text-xs font-medium text-muted-foreground">{summary.fact}</span>
                </div>
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

      <details
        ref={searchDisclosureRef}
        data-testid="system-search-details"
        open={requestedSearch || search.status !== 'healthy'}
        className="group overflow-hidden rounded-xl border border-border bg-card"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Search details</span>
            <span className="block text-xs font-normal text-muted-foreground">Readiness stages, traffic, indexes, journal, and enrichment.</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <StatusBadge variant="outline" tone={SUMMARY_STYLE[search.status].tone}>{search.statusLabel}</StatusBadge>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          </span>
        </summary>
        <div
          ref={searchDetailRef}
          tabIndex={-1}
          aria-label="Search subsystem detail"
          className="scroll-mt-4 border-t border-border p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
          />
        </div>
      </details>

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
        onCheckUpdates={data.checkPluginUpdates}
        onUpgrade={data.upgradePlugin}
      />
    </div>
  )
}
