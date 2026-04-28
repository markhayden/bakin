/**
 * System check — runtime gateway reachability.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). NOT auto-fixable —
 * starting the gateway requires human intervention.
 */
import { pingRuntime } from '../../../../src/core/runtime-registry'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export async function checkGateway(): Promise<HealthCheckResult[]> {
  try {
    const alive = await pingRuntime()
    if (alive) {
      return [{ check: 'gateway', status: 'ok', message: 'Runtime gateway is reachable', autoFixable: false }]
    }
    return [{ check: 'gateway', status: 'error', message: 'Runtime gateway is not responding', autoFixable: false }]
  } catch (err) {
    return [{ check: 'gateway', status: 'error', message: `Gateway check failed: ${err}`, autoFixable: false }]
  }
}
