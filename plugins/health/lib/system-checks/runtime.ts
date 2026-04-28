/**
 * System check — runtime adapter reachability.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). NOT auto-fixable —
 * starting the runtime requires human intervention.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export async function checkRuntime(runtime: Pick<AgentRuntimeAdapter, 'ping'>): Promise<HealthCheckResult[]> {
  try {
    const alive = await runtime.ping()
    if (alive) {
      return [{ check: 'runtime', status: 'ok', message: 'Runtime is reachable', autoFixable: false }]
    }
    return [{ check: 'runtime', status: 'error', message: 'Runtime is not responding', autoFixable: false }]
  } catch (err) {
    return [{ check: 'runtime', status: 'error', message: `Runtime check failed: ${err}`, autoFixable: false }]
  }
}
