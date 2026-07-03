/**
 * System check — search adapter binary install + connection.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). When search is
 * disabled, the binary check is informational; when enabled, a missing
 * binary or unreachable daemon surfaces as an error.
 */
import { getSettings } from '../../../../src/core/settings'
import { healthOk, healthWarn, healthError } from '@makinbakin/sdk/utils'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return healthOk('search', message)
}
function warn(message: string): HealthCheckResult {
  return healthWarn('search', message)
}
function error(message: string): HealthCheckResult {
  return healthError('search', message)
}

export async function checkSearchAdapter(): Promise<HealthCheckResult[]> {
  const settings = getSettings()
  const adapter = settings.search.adapter
  const searchSettings = settings.search.settings
  // Lazy import keeps adapter helper setup off the cold path when the
  // check returns early (matches the original migration's pattern).
  const { isSearchAdapterInstalled } = await import('../../../../src/core/search-adapter-factory')

  if (!searchSettings.enabled) {
    if (!isSearchAdapterInstalled(adapter)) {
      return [warn('Search disabled and active search adapter binary is not installed')]
    }
    return [ok('Search disabled — active search adapter binary installed, enable with: bakin settings set search.settings.enabled true')]
  }

  if (!isSearchAdapterInstalled(adapter)) {
    return [error('Search enabled but active search adapter binary was not found')]
  }

  // Supervision status (D3): who keeps the engine alive, and is the unit
  // provisioned? A missing unit means nothing restarts the engine after a
  // crash — `bakin install search` provisions it.
  const results: HealthCheckResult[] = []
  try {
    const { getSearchAdapterServiceStatus } = await import('../../../../src/core/search-adapter-factory')
    const service = getSearchAdapterServiceStatus(adapter, searchSettings)
    if (!service.provisioned) {
      results.push(warn(`Engine service not provisioned (${service.mode}): ${service.detail ?? 'unit missing'} — run: bakin install search`))
    } else {
      results.push(ok(`Engine supervised via ${service.mode}${service.detail ? ` — ${service.detail}` : ''}`))
    }
  } catch (err) {
    results.push(warn(`Could not determine engine supervision mode: ${err instanceof Error ? err.message : String(err)}`))
  }

  // Ask the LIVE adapter instead of probing a hardcoded HTTP endpoint: the
  // old check hit the pre-0.2 `/api/v1/status` path, which the v0.2 zig
  // server does not serve — so a perfectly healthy instance reported
  // "connection failed" as a doctor ERROR on every run. available() also
  // reflects a crashed/supervised child, which a raw port probe cannot.
  const { getAppServices } = await import('../../../../src/core/app-services')
  if (await getAppServices().search.available()) {
    results.push(ok('Search adapter connected'))
  } else {
    results.push(error('Search enabled but the engine is unavailable — check the engine lines in ~/.bakin/logs/server.log'))
  }
  return results
}
