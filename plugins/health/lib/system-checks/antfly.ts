/**
 * System check — Antfly binary install + connection.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). When Antfly is
 * disabled, the binary check is informational; when enabled, a missing
 * binary or unreachable daemon surfaces as an error.
 */
import { getSettings } from '../../../../src/core/settings'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return { check: 'antfly', status: 'ok', message, autoFixable: false }
}
function warn(message: string): HealthCheckResult {
  return { check: 'antfly', status: 'warn', message, autoFixable: false }
}
function error(message: string): HealthCheckResult {
  return { check: 'antfly', status: 'error', message, autoFixable: false }
}

export async function checkAntfly(): Promise<HealthCheckResult[]> {
  const settings = getSettings()
  // Lazy import — keeps antfly-server's setup off the cold path when the
  // check returns early (matches the original migration's pattern).
  const { installed } = await import('../../../../src/core/antfly-server')

  if (!settings.antfly.enabled) {
    if (!installed()) {
      return [warn('Antfly disabled and binary not installed — install with: brew install --cask antflydb/antfly/antfly')]
    }
    return [ok('Antfly disabled — binary installed, enable with: bakin settings set antfly.enabled true')]
  }

  if (!installed()) {
    return [error('Antfly enabled but binary not found — install with: brew install --cask antflydb/antfly/antfly')]
  }

  const urls = Array.from(new Set([
    settings.antfly.url.replace(/\/api\/v1\/?$/, ''),
    settings.antfly.url.replace('localhost', '127.0.0.1').replace(/\/api\/v1\/?$/, ''),
  ]))

  let lastErr: unknown
  for (const base of urls) {
    try {
      const res = await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const status = await res.json()
        return [ok(`Antfly connected (health: ${status?.health})`)]
      }
      lastErr = new Error(`status ${res.status}`)
    } catch (err) {
      lastErr = err
    }
  }

  return [error(`Antfly connection failed: ${lastErr}`)]
}
