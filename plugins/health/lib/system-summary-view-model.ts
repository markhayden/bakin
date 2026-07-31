import type { SearchReadiness } from '@makinbakin/sdk/types'
import type { UseSystemDataResult } from '../hooks/use-system-data'
import { mergeSystemPlugins, presentSystemCheck } from './system-view-model'

export type SummaryStatus = 'healthy' | 'watching' | 'attention' | 'unknown' | 'neutral'

export interface SubsystemSummary {
  key: 'runtime' | 'search' | 'plugins' | 'diagnostics'
  label: string
  status: SummaryStatus
  statusLabel: string
  headline: string
  summary: string
  fact: string
}

export function searchEvidenceStale(readiness: SearchReadiness, now: number = Date.now()): boolean {
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

export function buildSubsystemSummaries(data: UseSystemDataResult): SubsystemSummary[] {
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
  const failedChecks = reviewChecks.filter((presentation) => presentation.tone === 'danger').length

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
