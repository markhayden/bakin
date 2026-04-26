/**
 * System check — content directory location.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies content lives
 * in ~/.bakin/ rather than the legacy ./content/ fallback. NOT
 * auto-fixable — migrating live data requires human judgment.
 */
import { getContentDir, isUsingBakinHome } from '../../../../packages/core/src/content-dir'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export function checkContentDir(): HealthCheckResult[] {
  const contentDir = getContentDir()
  if (isUsingBakinHome()) {
    return [{ check: 'content-dir', status: 'ok', message: `Content directory: ${contentDir}`, autoFixable: false }]
  }
  return [{
    check: 'content-dir',
    status: 'warn',
    message: `Content lives at ${contentDir} instead of ~/.bakin/ — run: bakin init && move content/* to ~/.bakin/`,
    autoFixable: false,
  }]
}
