/**
 * System check — content directory location.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies the resolved Bakin
 * home path after content-dir resolution.
 */
import { getContentDir } from '../../../../packages/core/src/content-dir'
import { healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration } from '@makinbakin/sdk'

/** This check only ever reports where the home resolved to. */
export const CONTENT_DIR_INCIDENTS: HealthIncidentDeclaration[] = []

export async function checkContentDir(): Promise<HealthCheckRunInput> {
  const contentDir = getContentDir()
  return healthObserved([healthHealthy({
    key: 'location',
    summary: 'Bakin home resolved.',
    detail: `Bakin stores its local state in ${contentDir}.`,
    evidence: { path: contentDir },
  })])
}
