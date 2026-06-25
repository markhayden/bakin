/**
 * Dependency-ordered plugin activation sort (Kahn's algorithm).
 *
 * One implementation for both the core-plugin and user-plugin passes — they
 * previously carried two near-identical copies (`topologicalSort` /
 * `topologicalSortUserPlugins`) that drifted in three ways, all captured here
 * as options:
 *   - `source`        — the failure record's source ('built-in' vs 'user').
 *   - `failOnMissingDep` — core fails an entry whose dependency isn't present;
 *     the user pass pre-filters missing deps in loadUserPlugins, so it skips
 *     the edge silently (false).
 *   - `logCycle`      — core logs a top-level error on a detected cycle.
 *
 * The result is always filtered against `isFailed` so entries this sort marked
 * failed (missing dep) don't reach activation. Cycle-failed entries never make
 * it into the result (Kahn's leaves them out), so the filter is a no-op for the
 * user pass — preserving its original behavior exactly.
 */
import { createLogger } from './logger'
import type { PluginFailureState, PluginLoadEntry } from './plugin-registry-types'

const log = createLogger('plugin-registry')

export interface TopoSortOptions {
  source: 'built-in' | 'user'
  failOnMissingDep: boolean
  logCycle: boolean
}

export interface TopoSortHooks {
  markFailed: (failure: PluginFailureState) => void
  isFailed: (id: string) => boolean
}

export function topologicalSortPlugins(
  entries: PluginLoadEntry[],
  opts: TopoSortOptions,
  hooks: TopoSortHooks,
): PluginLoadEntry[] {
  const byId = new Map(entries.map(e => [e.id, e]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const e of entries) {
    inDegree.set(e.id, 0)
    dependents.set(e.id, [])
  }

  for (const e of entries) {
    for (const dep of e.deps) {
      if (!byId.has(dep)) {
        if (opts.failOnMissingDep) {
          hooks.markFailed({
            id: e.id,
            name: e.manifest?.name ?? e.id,
            version: e.manifest?.version ?? '0.0.0',
            description: e.manifest?.description ?? '',
            source: opts.source,
            errorCode: 'missing_dependency',
            errorMessage: `Missing dependency: ${dep}`,
            missingDependencies: [dep],
          })
        }
        continue
      }
      inDegree.set(e.id, (inDegree.get(e.id) ?? 0) + 1)
      dependents.get(dep)!.push(e.id)
    }
  }

  // Start with nodes that have no dependencies.
  const queue = entries.filter(e => inDegree.get(e.id) === 0).map(e => e.id)
  const result: PluginLoadEntry[] = []

  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(byId.get(id)!)
    for (const dep of dependents.get(id) ?? []) {
      const deg = (inDegree.get(dep) ?? 1) - 1
      inDegree.set(dep, deg)
      if (deg === 0) queue.push(dep)
    }
  }

  // Detect cycles — any entries not in result have circular deps.
  if (result.length < entries.length) {
    const missing = entries.filter(e => !result.some(r => r.id === e.id))
    const cycle = missing.map(e => e.id).join(' ↔ ')
    if (opts.logCycle) log.error(`Circular plugin dependencies detected: ${cycle}`)
    for (const entry of missing) {
      hooks.markFailed({
        id: entry.id,
        name: entry.manifest?.name ?? entry.id,
        version: entry.manifest?.version ?? '0.0.0',
        description: entry.manifest?.description ?? '',
        source: opts.source,
        errorCode: 'dependency_cycle',
        errorMessage: `Circular plugin dependency detected: ${cycle}`,
      })
    }
  }

  return result.filter(entry => !hooks.isFailed(entry.id))
}
