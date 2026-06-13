import type { SkillDefinition } from '../plugin-types'

/**
 * Process-singleton registry of plugin-contributed skills (keyed by name,
 * first-registered wins). A dependency-free leaf — the plugin loader, the
 * reload pipeline, and the workflows plugin all import it from HERE rather
 * than from the loader, so skill consumers (e.g. workflow-skill-drift) don't
 * form an import cycle back through plugin-registry. globalThis-backed so one
 * process keeps one map across dev HMR re-evaluation.
 */
const g = globalThis as typeof globalThis & { __bakinPluginSkills?: Map<string, SkillDefinition> }
const pluginSkills: Map<string, SkillDefinition> = (g.__bakinPluginSkills ??= new Map())

/** The shared plugin-skill map. */
export function getPluginSkills(): Map<string, SkillDefinition> {
  return pluginSkills
}

/** Remove all skills contributed by a plugin. Returns the count removed. */
export function removePluginSkillsByPlugin(pluginId: string): number {
  let removed = 0
  const source = `plugin:${pluginId}`
  for (const [name, skill] of [...pluginSkills.entries()]) {
    if (skill.source === source) {
      pluginSkills.delete(name)
      removed++
    }
  }
  return removed
}

/** Clear the registry (registry reset / tests). */
export function clearPluginSkills(): void {
  pluginSkills.clear()
}
