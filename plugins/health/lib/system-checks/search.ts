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

  const urls = Array.from(new Set([
    searchSettings.url.replace(/\/api\/v1\/?$/, ''),
    searchSettings.url.replace('localhost', '127.0.0.1').replace(/\/api\/v1\/?$/, ''),
  ]))

  let lastErr: unknown
  for (const base of urls) {
    try {
      const res = await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const status = await res.json()
        return [ok(`Search adapter connected (health: ${status?.health})`)]
      }
      lastErr = new Error(`status ${res.status}`)
    } catch (err) {
      lastErr = err
    }
  }

  return [error(`Search adapter connection failed: ${lastErr}`)]
}
