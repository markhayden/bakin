import type { HealthCheckState, HealthObservation, HealthReport } from '@makinbakin/sdk/types'
import type { StatusTone } from '@makinbakin/sdk/patterns'
import type {
  SystemPluginManifestData,
  SystemPluginManifestEntry,
  SystemRegistryData,
  SystemRegistryPlugin,
} from '../hooks/use-system-data'

export interface InventoryPlugin {
  id: string
  name: string
  description: string
  version: string
  latestVersion?: string | null
  source: string
  routes: number
  status: 'active' | 'failed' | 'unknown'
  upgradeAvailable: boolean
  errorCode?: string
  errorMessage?: string
  missingDependencies?: string[]
  activationConflict: boolean
}

export interface CheckPresentation {
  label: string
  tone: StatusTone
  detail: string
  concerning: boolean
}

export interface SystemFinding {
  id: string
  kind: 'check' | 'plugin'
  title: string
  detail: string
  category: string
  label: string
  tone: StatusTone
  targetId: string
  rank: number
}

const OBSERVATION_RANK: Record<HealthObservation['status'], number> = {
  healthy: 0,
  warning: 1,
  unknown: 2,
  error: 3,
}

const FINDING_RANK: Record<StatusTone, number> = {
  danger: 0,
  attention: 1,
  neutral: 2,
  accent: 3,
  success: 4,
}

export function mergeSystemPlugins(
  registry: SystemRegistryData | null,
  manifest: SystemPluginManifestData | null,
): InventoryPlugin[] {
  const registryById = new Map((registry?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const manifestById = new Map((manifest?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const ids = new Set([...registryById.keys(), ...manifestById.keys()])
  return [...ids].map((id) => {
    const active: SystemRegistryPlugin | undefined = registryById.get(id)
    const installed: SystemPluginManifestEntry | undefined = manifestById.get(id)
    const membershipConflict = registry !== null
      && manifest !== null
      && Boolean(active) !== Boolean(installed)
    const statusConflict = active?.status !== undefined
      && installed?.status !== undefined
      && active.status !== installed.status
    const activationConflict = membershipConflict || statusConflict
    const status: InventoryPlugin['status'] = activationConflict
      ? 'unknown'
      : active?.status ?? installed?.status ?? 'unknown'
    return {
      id,
      name: active?.name ?? installed?.name ?? id,
      description: active?.description ?? '',
      version: installed?.version ?? active?.version ?? 'unknown',
      latestVersion: installed?.latestVersion,
      source: installed?.source ?? active?.source ?? 'unknown',
      routes: active?.routes ?? 0,
      status,
      upgradeAvailable: installed?.upgradeAvailable ?? false,
      errorCode: active?.errorCode ?? installed?.errorCode,
      errorMessage: active?.errorMessage ?? installed?.errorMessage,
      missingDependencies: active?.missingDependencies ?? installed?.missingDependencies,
      activationConflict,
    }
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

function worstObservation(observations: readonly HealthObservation[]): HealthObservation | null {
  return observations.reduce<HealthObservation | null>((worst, observation) => {
    if (!worst) return observation
    if (observation.snapshot === 'last_known' && worst.snapshot !== 'last_known') return observation
    if (worst.snapshot === 'last_known' && observation.snapshot !== 'last_known') return worst
    return OBSERVATION_RANK[observation.status] > OBSERVATION_RANK[worst.status] ? observation : worst
  }, null)
}

export function presentSystemCheck(check: HealthCheckState, now: number = Date.now()): CheckPresentation {
  const execution = check.latestExecution
  if (execution.outcome === 'not_applicable') {
    return {
      label: 'Not applicable', tone: 'neutral', concerning: false,
      detail: execution.reason ?? 'This check does not apply to the current configuration.',
    }
  }
  if (execution.outcome === 'failed' || execution.outcome === 'invalid') {
    return {
      label: 'Unable to verify', tone: 'neutral', concerning: true,
      detail: execution.error?.message ?? `The check ${execution.outcome}.`,
    }
  }
  const observation = worstObservation(check.latestValidSnapshot?.observations ?? [])
  if (!observation) {
    return { label: 'Unable to verify', tone: 'neutral', concerning: true, detail: 'No valid evidence was returned.' }
  }
  if (observation.snapshot === 'last_known') {
    return {
      label: 'Last known', tone: 'neutral', concerning: true,
      detail: `${observation.summary} Current evidence could not be verified.`,
    }
  }
  const staleAt = Date.parse(observation.staleAt)
  if (Number.isNaN(staleAt) || staleAt <= now) {
    return {
      label: 'Evidence expired', tone: 'neutral', concerning: true,
      detail: `${observation.summary} Run checks to verify the current state.`,
    }
  }
  switch (observation.status) {
    case 'healthy': return { label: 'Healthy', tone: 'success', concerning: false, detail: observation.summary }
    case 'warning': return { label: 'Watching', tone: 'attention', concerning: true, detail: observation.summary }
    case 'error': return { label: 'Needs attention', tone: 'danger', concerning: true, detail: observation.summary }
    case 'unknown': return { label: 'Unable to verify', tone: 'neutral', concerning: true, detail: observation.summary }
  }
}

export function buildSystemFindings(
  report: HealthReport | null,
  registry: SystemRegistryData | null,
  manifest: SystemPluginManifestData | null,
  {
    reportCurrent = true,
    pluginInventoryCurrent = true,
  }: {
    reportCurrent?: boolean
    pluginInventoryCurrent?: boolean
  } = {},
): SystemFinding[] {
  const checkFindings = (report?.checks ?? []).flatMap((check): SystemFinding[] => {
    const currentPresentation = presentSystemCheck(check)
    if (!currentPresentation.concerning) return []
    const presentation = !reportCurrent && currentPresentation.tone !== 'neutral'
      ? {
          ...currentPresentation,
          label: 'Last loaded',
          tone: 'neutral' as const,
          detail: `${currentPresentation.detail} Current health-check evidence could not be refreshed.`,
        }
      : currentPresentation
    return [{
      id: `check:${check.checkId}`,
      kind: 'check',
      title: check.checkName,
      detail: presentation.detail,
      category: check.group.label,
      label: presentation.label,
      tone: presentation.tone,
      targetId: check.checkId,
      rank: FINDING_RANK[presentation.tone],
    }]
  })

  const pluginFindings = mergeSystemPlugins(registry, manifest).flatMap((plugin): SystemFinding[] => {
    if (plugin.status === 'failed') {
      const detail = plugin.errorMessage ?? 'The plugin did not activate.'
      return [{
        id: `plugin:${plugin.id}:failed`,
        kind: 'plugin',
        title: plugin.name,
        detail: pluginInventoryCurrent
          ? detail
          : `${detail} This is the last loaded activation state; refresh live data to confirm it.`,
        category: 'Installed features',
        label: pluginInventoryCurrent ? 'Failed to activate' : 'Last loaded',
        tone: pluginInventoryCurrent ? 'danger' : 'neutral',
        targetId: plugin.id,
        rank: FINDING_RANK[pluginInventoryCurrent ? 'danger' : 'neutral'],
      }]
    }
    if (plugin.status === 'unknown') {
      return [{
        id: `plugin:${plugin.id}:unknown`,
        kind: 'plugin',
        title: plugin.name,
        detail: !pluginInventoryCurrent
          ? 'The last loaded plugin inventory could not be refreshed.'
          : plugin.activationConflict
          ? 'Activation sources disagree; refresh live data to confirm the current state.'
          : 'The plugin is installed, but its activation state could not be confirmed.',
        category: 'Installed features',
        label: 'Unable to verify',
        tone: 'neutral',
        targetId: plugin.id,
        rank: FINDING_RANK.neutral,
      }]
    }
    if (plugin.upgradeAvailable) {
      return [{
        id: `plugin:${plugin.id}:update`,
        kind: 'plugin',
        title: plugin.name,
        detail: pluginInventoryCurrent
          ? `Version ${plugin.latestVersion ?? 'latest'} is available; ${plugin.version} is installed.`
          : `Version ${plugin.latestVersion ?? 'latest'} was last reported available; refresh live data to confirm it.`,
        category: 'Installed features',
        label: pluginInventoryCurrent ? 'Update available' : 'Last loaded',
        tone: pluginInventoryCurrent ? 'accent' : 'neutral',
        targetId: plugin.id,
        rank: FINDING_RANK[pluginInventoryCurrent ? 'accent' : 'neutral'],
      }]
    }
    return []
  })

  return [...checkFindings, ...pluginFindings]
    .sort((left, right) => left.rank - right.rank || left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
}
