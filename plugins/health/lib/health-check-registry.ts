/**
 * Health-check registry — plugin-contributed doctor checks.
 *
 * Core doctor checks in `src/core/doctor.ts` stay as direct calls inside
 * `runDiagnostics()`. This registry is purely for plugin contributions —
 * no builtin self-seeding. Plugins register their checks via
 * `ctx.registerHealthCheck()` in `activate()`; the orchestrator iterates
 * this Map at the end of each doctor pass and appends per-plugin results
 * alongside the builtin sweep.
 *
 * Per-check try/catch lives in the orchestrator, not here — this module
 * is a pure data store.
 */
import type {
  HealthCheckDef,
  PluginHealthCheckInput,
} from '../../../packages/core/src/plugin-types'

export type { HealthCheckDef, PluginHealthCheckInput }

// ─── Registry store ─────────────────────────────────────────────────────────

const registry = new Map<string, HealthCheckDef>()

export function registerHealthCheck(def: HealthCheckDef): void {
  if (registry.has(def.id)) {
    throw new Error(`Health check "${def.id}" is already registered`)
  }
  registry.set(def.id, def)
}

export function getHealthCheck(id: string): HealthCheckDef | undefined {
  return registry.get(id)
}

export function listHealthChecks(): HealthCheckDef[] {
  return Array.from(registry.values())
}

/** Remove a single registration. Useful for test cleanup. */
export function unregisterHealthCheck(id: string): void {
  registry.delete(id)
}

/** Remove every check owned by a plugin. Called at plugin teardown / hot reload. */
export function unregisterPluginHealthChecks(pluginId: string): void {
  for (const [id, def] of registry.entries()) {
    if (def.pluginId === pluginId) {
      registry.delete(id)
    }
  }
}

// ─── Plugin-side registration helper ────────────────────────────────────────

/**
 * Register a plugin-owned health check. The id is auto-namespaced to
 * `{pluginId}.{id}` so two plugins can ship the same unprefixed id
 * without colliding. Returns the namespaced id so callers can reference
 * it from downstream code and tests.
 */
export function registerPluginHealthCheck(
  pluginId: string,
  input: PluginHealthCheckInput,
): string {
  const namespacedId = `${pluginId}.${input.id}`
  registerHealthCheck({
    runtime: 'plugin',
    pluginId,
    id: namespacedId,
    name: input.name,
    run: input.run,
    autoFix: input.autoFix,
  })
  return namespacedId
}
