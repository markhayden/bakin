'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { SearchReadiness } from '@makinbakin/sdk/types'
import { Button } from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
import { SystemSearchSection } from './system-search-section'
import { SystemInventory } from './system-inventory'
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
  const pluginInventoryPending = !data.registry.data && !data.pluginManifest.data
  const failedIds = new Set([
    ...plugins.filter((plugin) => plugin.status === 'failed').map((plugin) => plugin.id),
    ...manifests.filter((plugin) => plugin.status === 'failed').map((plugin) => plugin.id),
  ])
  const failedPlugins = failedIds.size
  const updates = manifests.filter((plugin) => plugin.upgradeAvailable).length
  const sessions = data.live.data?.activeSessions?.reduce((total, row) => total + row.sessions, 0) ?? null
  const checks = data.report.data?.checks ?? []
  const unverified = checks.filter((check) => check.latestExecution.outcome === 'failed' || check.latestExecution.outcome === 'invalid').length
  const unhealthy = data.report.data?.observations.filter((observation) => observation.status !== 'healthy').length ?? 0

  const pluginSummary: SubsystemSummary = pluginInventoryPending
    ? {
        key: 'plugins', label: 'Plugins', status: 'unknown', statusLabel: 'Checking',
        summary: 'Waiting for the installed plugin inventory.', fact: 'Loading inventory',
      }
    : failedPlugins > 0
    ? {
        key: 'plugins', label: 'Plugins', status: 'attention', statusLabel: 'Needs attention',
        summary: `${failedPlugins} ${failedPlugins === 1 ? 'plugin failed' : 'plugins failed'} to activate.`,
        fact: updates > 0 ? `${updates} updates available` : 'Activation failed',
      }
    : data.registry.error && !data.registry.data
      ? {
          key: 'plugins', label: 'Plugins', status: 'unknown', statusLabel: 'Unable to verify',
          summary: data.registry.error, fact: 'Inventory unavailable',
        }
      : {
          key: 'plugins', label: 'Plugins', status: updates > 0 ? 'neutral' : 'healthy',
          statusLabel: updates > 0 ? 'Updates available' : 'Healthy',
          summary: updates > 0 ? `${updates} ${updates === 1 ? 'plugin has' : 'plugins have'} an available update.` : 'All discovered plugins are active.',
          fact: `${pluginIds.size} discovered`,
        }

  const runtimeSummary: SubsystemSummary = data.live.error && !data.live.data
    ? {
        key: 'runtime', label: 'Runtime', status: 'unknown', statusLabel: 'Unable to verify',
        summary: data.live.error, fact: 'Host unavailable',
      }
    : data.live.data?.server
      ? {
          key: 'runtime', label: 'Runtime', status: 'healthy', statusLabel: 'Online',
          summary: `Host process ${data.live.data.server.pid} is serving on port ${data.live.data.server.port}.`,
          fact: sessions === null ? 'Session count unavailable' : `${sessions} connected ${sessions === 1 ? 'session' : 'sessions'}`,
        }
      : {
          key: 'runtime', label: 'Runtime', status: 'unknown', statusLabel: 'Checking',
          summary: 'Waiting for current host process details.', fact: 'Loading runtime',
        }

  const diagnosticsSummary: SubsystemSummary = !data.report.data
    ? {
        key: 'diagnostics', label: 'Diagnostics', status: 'unknown', statusLabel: 'Unable to verify',
        summary: data.report.error ?? 'Waiting for the canonical health report.', fact: 'No report',
      }
    : unverified > 0
      ? {
          key: 'diagnostics', label: 'Diagnostics', status: 'unknown', statusLabel: 'Incomplete',
          summary: `${unverified} ${unverified === 1 ? 'check could' : 'checks could'} not be verified.`, fact: `${checks.length} registered checks`,
        }
      : unhealthy > 0
        ? {
            key: 'diagnostics', label: 'Diagnostics', status: 'attention', statusLabel: 'Findings',
            summary: `${unhealthy} non-healthy ${unhealthy === 1 ? 'observation needs' : 'observations need'} review.`, fact: `${checks.length} completed checks`,
          }
        : {
            key: 'diagnostics', label: 'Diagnostics', status: 'healthy', statusLabel: 'Verified',
            summary: 'All completed checks returned healthy evidence.', fact: `${checks.length} completed checks`,
          }

  return [searchSummary(data), pluginSummary, runtimeSummary, diagnosticsSummary]
}

export function SystemTab() {
  return <SystemTabView data={useSystemData()} />
}

/** Presentation-only seam retained so contract-heavy System states stay easy to test. */
export function SystemTabView({ data, section }: { data: UseSystemDataResult; section?: string | null }) {
  const searchDetailRef = useRef<HTMLDivElement>(null)
  const summaries = useMemo(() => subsystemSummaries(data), [data])
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
      searchDetailRef.current?.focus()
    }
  }, [section])

  return (
    <div className="@container/health-system space-y-6" data-testid="health-system-tab">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">System</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Are Search, the runtime, installed plugins, and registered checks working?
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => void data.refreshSystemDetails()}
        >
          {refreshing ? 'Refreshing…' : 'Refresh system details'}
        </Button>
      </header>

      <section aria-labelledby="system-subsystems-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 id="system-subsystems-title" className="text-base font-semibold">Subsystem status</h2>
            <p className="text-sm text-muted-foreground">The shortest path to what is unavailable or needs attention.</p>
          </div>
        </div>
        <div className="grid gap-3 @[34rem]/health-system:grid-cols-2 @[68rem]/health-system:grid-cols-4">
          {summaries.map((summary) => {
            const style = SUMMARY_STYLE[summary.status]
            return (
              <article key={summary.key} className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${style.accent}`} />
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{summary.label}</h3>
                  <StatusBadge variant="outline" tone={style.tone}>{summary.statusLabel}</StatusBadge>
                </div>
                <p className="mt-3 min-h-10 text-sm leading-relaxed text-muted-foreground">{summary.summary}</p>
                <p className="mt-3 border-t border-border pt-2 text-xs font-medium">{summary.fact}</p>
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

      <div
        ref={searchDetailRef}
        tabIndex={-1}
        aria-label="Search subsystem detail"
        className="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
