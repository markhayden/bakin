/**
 * Agent-package skill registry — workflow skills shipped by installed
 * agent-packages (kind: "agent" or "workflow-pack"), held in memory and
 * resolved between the plugin tier and the user-on-disk tier by
 * skill-loader.ts.
 *
 * Mirrors the shape of `source-registry.ts` (workflows definitions) so the
 * resolution semantics stay consistent across both registries:
 *
 *   user > agent-package > plugin
 *
 * Population: server boot reads ~/.bakin/packages/lock.json and calls
 * `registerAgentPackageSkill(packageId, name, skill)` for each
 * `contributions.workflowSkills` entry. Same call happens after `bakin
 * agents install/update`. `bakin agents remove` calls
 * `unregisterAgentPackageSkills(packageId)`. No restart required.
 *
 * Backed by globalThis so a single process keeps one registry instance
 * even when this module is reached from multiple entry points.
 */
import type { SkillDefinition } from '@bakin/core/plugin-types'

interface AgentPackageSkillEntry {
  packageId: string
  skill: SkillDefinition
}

interface SkillStore {
  agentPackage: Map<string, AgentPackageSkillEntry>
}

declare global {
  var __bakinAgentPackageSkills: SkillStore | undefined
}

function getStore(): SkillStore {
  if (!globalThis.__bakinAgentPackageSkills) {
    globalThis.__bakinAgentPackageSkills = { agentPackage: new Map() }
  }
  return globalThis.__bakinAgentPackageSkills
}

/**
 * Register an agent-package-owned workflow skill.
 * Throws if a *different* package has already registered the same name; the
 * same package may overwrite its own registration (update / hot reload).
 */
export function registerAgentPackageSkill(
  packageId: string,
  name: string,
  skill: SkillDefinition,
): void {
  const store = getStore()
  const existing = store.agentPackage.get(name)
  if (existing && existing.packageId !== packageId) {
    throw new Error(
      `Workflow skill "${name}" is already registered by agent-package ` +
        `"${existing.packageId}" (attempted by "${packageId}")`,
    )
  }
  store.agentPackage.set(name, { packageId, skill })
}

/**
 * Remove every skill owned by `packageId`. Called by the uninstaller on
 * `bakin agents remove` — the lockfile entry vanishing is the only signal
 * needed for the loader to stop resolving the package's skills.
 */
export function unregisterAgentPackageSkills(packageId: string): void {
  const store = getStore()
  for (const [name, entry] of store.agentPackage) {
    if (entry.packageId === packageId) store.agentPackage.delete(name)
  }
}

/** Return the in-memory skill registry as a read-only map (name → skill). */
export function getAgentPackageSkills(): Map<string, SkillDefinition> {
  const store = getStore()
  const flat = new Map<string, SkillDefinition>()
  for (const [name, entry] of store.agentPackage) {
    flat.set(name, entry.skill)
  }
  return flat
}

/** Look up the package id that owns a given skill name, if any. */
export function getAgentPackageSkillOwner(name: string): string | undefined {
  return getStore().agentPackage.get(name)?.packageId
}

/**
 * Test-only helper: clear all agent-package skill state. Production code
 * uses `unregisterAgentPackageSkills(packageId)`.
 */
export function clearAgentPackageSkillRegistry(): void {
  getStore().agentPackage.clear()
}
