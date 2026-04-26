/**
 * System check — OpenClaw HTTP gateway reachability.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). NOT auto-fixable —
 * starting the gateway requires human intervention.
 */
import * as openclaw from '../../../../src/core/openclaw-client'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export async function checkGateway(): Promise<HealthCheckResult[]> {
  try {
    const alive = await openclaw.ping()
    if (alive) {
      return [{ check: 'gateway', status: 'ok', message: 'OpenClaw gateway is reachable', autoFixable: false }]
    }
    return [{ check: 'gateway', status: 'error', message: 'OpenClaw gateway is not responding', autoFixable: false }]
  } catch (err) {
    return [{ check: 'gateway', status: 'error', message: `Gateway check failed: ${err}`, autoFixable: false }]
  }
}
