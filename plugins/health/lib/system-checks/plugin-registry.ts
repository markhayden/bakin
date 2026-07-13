import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'

type RegistryAccessor = () => Array<Record<string, unknown>>

function getRegistrySnapshot(): Array<Record<string, unknown>> {
  const accessor = (globalThis as unknown as { __bakinGetRegistrySnapshot?: RegistryAccessor })
    .__bakinGetRegistrySnapshot
  return accessor ? accessor() : []
}

export async function checkPluginRegistry(): Promise<HealthCheckRunInput> {
  const plugins = getRegistrySnapshot()
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
