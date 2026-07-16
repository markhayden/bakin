/**
 * System check — runtime adapter reachability.
 *
 * Migrated out of src/core/doctor.ts (#139 C7). NOT auto-fixable —
 * starting the runtime requires human intervention.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'

export async function checkRuntime(runtime: Pick<AgentRuntimeAdapter, 'ping'>): Promise<HealthCheckRunInput> {
  try {
    const alive = await runtime.ping()
    if (alive) {
      return healthObserved([healthHealthy({
        key: 'reachability',
        summary: 'Runtime can serve turns.',
        evidence: { reachable: true },
      })])
    }
    return healthObserved([runtimeUnavailable('The runtime health probe returned false.')])
  } catch (err) {
    return healthObserved([runtimeUnavailable(
      err instanceof Error ? err.message : String(err),
    )])
  }
}

function runtimeUnavailable(detail: string) {
  return healthError({
    key: 'reachability',
    summary: 'Runtime cannot serve turns.',
    detail,
    evidence: { reachable: false },
    incident: {
      key: 'unreachable',
      title: 'Runtime is unreachable',
      impact: 'Agents cannot start or continue turns while the runtime is unavailable.',
      disposition: 'action_required',
      resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
      resolution: {
        key: 'restore-runtime',
        type: 'instructions',
        label: 'Restore the runtime',
        steps: [
          'Start the configured runtime gateway.',
          'Verify the runtime connection settings and required authentication.',
          'Rerun Health after the runtime is reachable.',
        ],
      },
    },
  })
}
