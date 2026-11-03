import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput } from '@makinbakin/sdk'
import { getRegistrySnapshot } from '../host-providers'
import { PLUGIN_UPGRADE_ACTION, pluginRepairResolution, pluginUpgradeOffer, type PluginArtifactDeps } from './plugin-artifacts'
import { stableKeyPart } from './key'

/** Row 101: the offered release repairs an activation failure; without one the fallback lane reads the activation error. Row 100 is an observation. */
export const PLUGIN_REGISTRY_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'activation-failed-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_UPGRADE_ACTION }, required: 'always' },
  { id: 'activation-failed', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
]

export async function checkPluginRegistry(deps?: PluginArtifactDeps): Promise<HealthCheckRunInput> {
  let plugins: Array<Record<string, unknown>>
  try {
    plugins = getRegistrySnapshot()
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'availability',
      summary: 'Plugin activation could not be verified.',
      detail: error instanceof Error ? error.message : String(error),
    })])
  }
  const failed = plugins.filter((plugin) => plugin.status === 'failed')
  if (failed.length === 0) {
    return healthObserved([healthHealthy({
      key: 'activation',
      summary: 'All registered plugins activated.',
      evidence: { registered: plugins.length, failed: 0 },
    })])
  }

  const observations = await Promise.all(failed.map(async (plugin): Promise<HealthObservationInput> => {
    const rawId = String(plugin.id ?? 'unknown')
    // A release the updates engine offers is the repair (row 101); without
    // one the fallback lane investigates with the activation error in its brief.
    const offer = await pluginUpgradeOffer(rawId, deps)
    const resolution = offer.kind === 'upgrade'
      ? pluginRepairResolution([{ pluginId: rawId, offer }])
      : { key: 'inspect-plugin', type: 'repair' as const, label: 'Investigate the activation failure', actionId: 'core.diagnose' }
    const id = stableKeyPart(rawId)
    const code = typeof plugin.errorCode === 'string' ? plugin.errorCode : 'activation_failed'
    const message = typeof plugin.errorMessage === 'string' && plugin.errorMessage.length > 0
      ? plugin.errorMessage
      : 'No failure details were recorded.'
    const label = rawId.slice(0, 120)
    return healthError({
      key: `plugin:${id}`,
      summary: `${label} failed to activate.`,
      detail: `${code}: ${message}`.slice(0, 4_000),
      evidence: { pluginId: rawId.slice(0, 500), errorCode: code.slice(0, 500) },
      incident: {
        key: `activation-failed:${id}`,
        title: 'Plugin activation failed',
        impact: 'The plugin and the features it contributes are unavailable.',
        disposition: 'action_required',
        subject: { kind: 'plugin', id, label },
        declarationId: offer.kind === 'upgrade' ? 'activation-failed-upgrade' : 'activation-failed',
        resources: [{ kind: 'plugin', id, label }],
        resolution,
      },
    })
  }))
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
