import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../content-dir'
import { readPluginLockfile } from '@bakin/core/plugins/lockfile'

/**
 * Core plugin ids that ship with the Bakin binary. This mirrors
 * `bakin.config.ts` but intentionally avoids importing plugin modules or
 * server-only static imports from install/onboarding paths.
 */
export const CORE_PLUGIN_IDS = new Set([
  'team',
  'tasks',
  'memory',
  'models',
  'workflows',
  'assets',
  'schedule',
  'health',
])

export interface DependencyPlanInput {
  id: string
  dependencies?: readonly string[]
}

export interface DependencyContext {
  coreIds?: ReadonlySet<string>
  installedIds?: ReadonlySet<string>
  selectedIds?: ReadonlySet<string>
}

export interface DependencyCheckResult {
  ok: boolean
  missing: string[]
  selfDependencies: string[]
}

export type DependencyPlanResult<T extends DependencyPlanInput> = {
  ok: true
  ordered: T[]
} | {
  ok: false
  error: string
  missing?: Array<{ pluginId: string; dependencies: string[] }>
  cycle?: string[]
}

function unique(values: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

export function getInstalledPluginIds(): Set<string> {
  const ids = new Set<string>()
  try {
    const lock = readPluginLockfile()
    for (const id of Object.keys(lock.plugins)) ids.add(id)
  } catch {
    // fall through to directory scan
  }

  const pluginsDir = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsDir)) return ids
  try {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const id = String(entry.name)
      if (id.startsWith('.')) continue
      if (existsSync(join(pluginsDir, id, 'bakin-plugin.json'))) ids.add(id)
    }
  } catch {
    // best-effort; lockfile ids are still useful
  }
  return ids
}

export function checkPluginDependencies(
  plugin: DependencyPlanInput,
  context: DependencyContext = {},
): DependencyCheckResult {
  const coreIds = context.coreIds ?? CORE_PLUGIN_IDS
  const installedIds = context.installedIds ?? getInstalledPluginIds()
  const selectedIds = context.selectedIds ?? new Set<string>()
  const missing: string[] = []
  const selfDependencies: string[] = []

  for (const dep of unique(plugin.dependencies)) {
    if (dep === plugin.id) {
      selfDependencies.push(dep)
      continue
    }
    if (coreIds.has(dep) || installedIds.has(dep) || selectedIds.has(dep)) continue
    missing.push(dep)
  }

  return {
    ok: missing.length === 0 && selfDependencies.length === 0,
    missing,
    selfDependencies,
  }
}

/**
 * Topologically sort selected plugins by dependencies that are also in
 * the selected set. Dependencies satisfied by core or installed plugins
 * are treated as already available. Queue order follows the input order
 * so the curated list remains the tie-breaker for independent plugins.
 */
export function planPluginDependencyOrder<T extends DependencyPlanInput>(
  plugins: readonly T[],
  context: DependencyContext = {},
): DependencyPlanResult<T> {
  const selectedIds = new Set(plugins.map(plugin => plugin.id))
  const missing: Array<{ pluginId: string; dependencies: string[] }> = []

  for (const plugin of plugins) {
    const check = checkPluginDependencies(plugin, { ...context, selectedIds })
    const unresolved = [...check.selfDependencies, ...check.missing]
    if (unresolved.length > 0) {
      missing.push({ pluginId: plugin.id, dependencies: unresolved })
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error: missing
        .map(item => `${item.pluginId}: ${item.dependencies.join(', ')}`)
        .join('; '),
    }
  }

  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const plugin of plugins) {
    inDegree.set(plugin.id, 0)
    dependents.set(plugin.id, [])
  }

  for (const plugin of plugins) {
    for (const dep of unique(plugin.dependencies)) {
      if (!selectedIds.has(dep)) continue
      inDegree.set(plugin.id, (inDegree.get(plugin.id) ?? 0) + 1)
      dependents.get(dep)!.push(plugin.id)
    }
  }

  const queue = plugins
    .filter(plugin => (inDegree.get(plugin.id) ?? 0) === 0)
    .map(plugin => plugin.id)
  const ordered: T[] = []

  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(byId.get(id)!)
    for (const dependent of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
  }

  if (ordered.length !== plugins.length) {
    const cycle = plugins
      .filter(plugin => !ordered.some(done => done.id === plugin.id))
      .map(plugin => plugin.id)
    return {
      ok: false,
      cycle,
      error: `Circular plugin dependencies detected: ${cycle.join(' -> ')}`,
    }
  }

  return { ok: true, ordered }
}
