import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'
import { getRegistrySnapshot } from '../host-providers'

export async function checkPluginRegistry(): Promise<HealthCheckRunInput> {
  let plugins: Array<Record<string, unknown>>
  try {
    plugins = getRegistrySnapshot()
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'availability',
      summary: 'Plugin activation could not be verified.',
      detail: error instanceof Error ? error.message : String(error),
      incident: {
        key: 'registry-unavailable',
        title: 'Plugin registry evidence is unavailable',
        impact: 'Health cannot confirm which plugins loaded or whether any activation failed.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'plugin-registry', label: 'Plugin registry' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
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

  const observations = failed.map<HealthObservationInput>((plugin) => {
    const rawId = String(plugin.id ?? 'unknown')
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
        resources: [{ kind: 'plugin', id, label }],
        resolution: {
          key: 'inspect-plugin',
          type: 'instructions',
          label: 'Inspect plugin activation',
          steps: [
            `Inspect the activation error for ${label}.`,
            'Update, reconfigure, or remove the plugin, then restart Bakin and rerun Health.',
          ],
          command: 'bakin plugins list --check',
        },
      },
    })
  })
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

function stableKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 100) || 'unknown'
}
