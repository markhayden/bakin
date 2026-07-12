/**
 * Plugin health-check RUNNER — a leaf module so the repair/delegate stack
 * can run checks without importing doctor.ts (whose escalation path imports
 * the repair stack back: that edge was an import cycle).
 */
import { listHealthChecks } from './health-check-registry'
import type { HealthCheckDef, HealthCheckResult } from '../../packages/core/src/plugin-types'

export interface DetailedHealthCheckRun {
  def: HealthCheckDef
  results: HealthCheckResult[]
}

/**
 * Run every plugin-registered health check in parallel. Per-check try/catch
 * isolates failures — a single bad handler yields one synthetic error result
 * and never crashes the doctor sweep. Exported separately from runDiagnostics
 * so the isolation behavior can be tested without mocking every plugin's
 * dependency tree.
 */
export async function runDetailedPluginHealthChecks(): Promise<DetailedHealthCheckRun[]> {
  const defs = listHealthChecks()
  return Promise.all(
    defs.map(async (def) => {
      try {
        const rows = await def.run()
        if (!Array.isArray(rows)) {
          return {
            def,
            results: [{
              check: def.id,
              status: 'error' as const,
              message: `Plugin health check returned non-array: ${typeof rows}`,
              autoFixable: false,
            }],
          }
        }
        return { def, results: rows }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          def,
          results: [{
            check: def.id,
            status: 'error' as const,
            message: `Plugin health check threw: ${message}`,
            autoFixable: false,
          }],
        }
      }
    }),
  )
}

export async function runPluginHealthChecks(): Promise<HealthCheckResult[]> {
  const groups = await runDetailedPluginHealthChecks()
  return groups.flatMap(group => group.results)
}
