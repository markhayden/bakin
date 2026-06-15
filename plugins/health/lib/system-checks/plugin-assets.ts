/**
 * System check — plugin-shipped runtime skills (S-B): surface install
 * state + drift. Migrated out of src/core/doctor.ts (#139 C8). Never
 * auto-installs — points the user at `bakin install plugin-assets`.
 */
import { pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return healthOk('plugin-assets', message)
}
function warn(message: string): HealthCheckResult {
  return healthWarn('plugin-assets', message)
}

export async function checkPluginAssets(): Promise<HealthCheckResult[]> {
  try {
    const result = await pluginAssetsComponent.check()
    if (result.status === 'ok') {
      return [ok(result.message)]
    }
    const reminder = result.remediation ?? 'Run `bakin install plugin-assets` to apply.'
    return [warn(`${result.message} — ${reminder}`)]
  } catch (err) {
    return [warn(`plugin-assets check failed: ${err}`)]
  }
}
