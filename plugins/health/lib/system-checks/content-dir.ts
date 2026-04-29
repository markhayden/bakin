/**
 * System check — content directory location.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies the resolved Bakin
 * home path after content-dir resolution.
 */
import { getContentDir } from '../../../../packages/core/src/content-dir'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export function checkContentDir(): HealthCheckResult[] {
  const contentDir = getContentDir()
  return [{ check: 'content-dir', status: 'ok', message: `Bakin home: ${contentDir}`, autoFixable: false }]
}
