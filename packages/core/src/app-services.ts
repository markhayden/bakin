import type { AdapterHealthCheckDefinition, AdapterHealthCheckResult } from './adapters/shared'
import type { AgentRuntimeAdapter } from './adapters/runtime'
import type { SearchAdapter } from './adapters/search'
import type { BakinTaskStore } from './tasks/store'

export interface HealthService {
  listChecks(): AdapterHealthCheckDefinition[]
  runAll(): Promise<AdapterHealthCheckResult[]>
}

export interface AppServices {
  runtime: AgentRuntimeAdapter
  search: SearchAdapter
  tasks: BakinTaskStore
  health: HealthService
}

export function createHealthService(
  sources: Array<{ getHealthChecks(): AdapterHealthCheckDefinition[] }>
): HealthService {
  return {
    listChecks: () => sources.flatMap((source) => source.getHealthChecks()),
    runAll: async () => {
      const results: AdapterHealthCheckResult[] = []
      for (const check of sources.flatMap((source) => source.getHealthChecks())) {
        try {
          results.push(...await check.run())
        } catch (err) {
          results.push({
            check: check.id,
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
            autoFixable: false,
          })
        }
      }
      return results
    },
  }
}
