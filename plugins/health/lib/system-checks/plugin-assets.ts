/**
 * System check — plugin-shipped runtime skills (S-B): surface install
 * state + drift. Migrated out of src/core/doctor.ts (#139 C8). Never
 * auto-installs — points the user at `bakin install plugin-assets`.
 */
import { pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'

export async function checkPluginAssets(): Promise<HealthCheckRunInput> {
  try {
    const result = await pluginAssetsComponent.check()
    if (result.status === 'ok') {
      return healthObserved([healthHealthy({
        key: 'runtime-assets',
        summary: result.message,
        evidence: { inSync: true },
      })])
    }
    const reminder = result.remediation ?? 'Run `bakin install plugin-assets` to apply.'
    return healthObserved([healthWarning({
      key: 'runtime-assets',
      summary: result.message,
      detail: reminder,
      evidence: { inSync: false },
      incident: {
        key: 'assets-out-of-sync',
        title: 'Plugin runtime assets need installation',
        impact: 'Runtime skills shipped by plugins may be missing or differ from their installed versions.',
        disposition: 'action_required',
        resources: [{ kind: 'asset', id: 'plugin-runtime-assets', label: 'Plugin runtime assets' }],
        resolution: {
          key: 'install-plugin-assets',
          type: 'instructions',
          label: 'Install plugin assets',
          steps: [reminder],
          command: 'bakin install plugin-assets',
        },
      },
    })])
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'runtime-assets',
      summary: 'Plugin runtime assets could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'inspection-failed',
        title: 'Plugin runtime asset status is unknown',
        impact: 'Health cannot confirm whether plugin-provided runtime skills are current.',
        disposition: 'watch',
        resources: [{ kind: 'asset', id: 'plugin-runtime-assets', label: 'Plugin runtime assets' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }
}
