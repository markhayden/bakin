/**
 * System check — plugin-shipped OpenClaw skills (S-B): surface install
 * state + drift. Migrated out of src/core/doctor.ts (#139 C8). Never
 * auto-installs — points the user at `bakin install plugin-assets`.
 */
import { pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return { check: 'plugin-assets', status: 'ok', message, autoFixable: false }
}
function warn(message: string): HealthCheckResult {
  return { check: 'plugin-assets', status: 'warn', message, autoFixable: false }
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
