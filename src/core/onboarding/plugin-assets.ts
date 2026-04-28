/**
 * plugin-assets onboarding component (S-B in the workflows-plugin spec).
 *
 * Plugins ship runtime skill packages at
 * `defaults/runtime-skills/{name}/SKILL.md` (+ optional `scripts/`,
 * other sibling files). This component installs them through the configured
 * runtime adapter so agents can invoke them.
 *
 * Workflow-step skills (S-A in the spec) are handled in-memory by the
 * plugin-skill-loader (`src/lib/plugin-skill-loader.ts`) — they never
 * touch this path.
 *
 * Drift detection:
 *   - `.installedBy` JSON marker records {pluginId, sha256(SKILL.md)}.
 *   - `.userEdited` sentinel (empty file the user creates) blocks
 *     overwrite forever — install() skips and reports.
 *   - SHA256 mismatch between source and recorded marker → drift.
 *
 * Idempotent: re-running install() on identical sources is a noop.
 */
import { createHash } from 'crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { getRuntimeAdapter } from '../runtime-registry'
import type { RuntimeSkill } from '@bakin/core/adapters/runtime'
import {
  type PluginLockfile,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:plugin-assets')

export interface PluginEntry {
  id: string
  path: string
}

export interface SkillRef {
  pluginId: string
  name: string
}

export interface SkillRefSkipped extends SkillRef {
  reason: 'userEdited'
}

export interface ScanReport {
  totalAvailable: number
  missing: SkillRef[]
  drifted: SkillRef[]
  installed: SkillRef[]
  userEdited: SkillRef[]
}

export interface InstallReport {
  installed: SkillRef[]
  unchanged: SkillRef[]
  skipped: SkillRefSkipped[]
}

interface InstalledMarker {
  pluginId: string
  sha256: string
}

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Walk a plugin's `defaults/runtime-skills/*` directories and return
 * one entry per skill that has a `SKILL.md`. Skills are 1 directory deep.
 *
 * Exported so install + upgrade flows can record `installedSkills` into
 * the lockfile (#119 hardening) — the lockfile becomes the canonical
 * record of which skills each plugin installed, so the uninstall flow
 * doesn't have to trust on-disk `.installedBy` markers blindly.
 */
export function findSkillsForPlugin(plugin: PluginEntry): Array<{ name: string; sourceDir: string }> {
  const skillsRoot = join(plugin.path, 'defaults', 'runtime-skills')
  if (!existsSync(skillsRoot)) return []
  const entries = readdirSync(skillsRoot, { withFileTypes: true })
  const skills: Array<{ name: string; sourceDir: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sourceDir = join(skillsRoot, entry.name)
    const skillFile = join(sourceDir, 'SKILL.md')
    if (existsSync(skillFile)) {
      skills.push({ name: entry.name, sourceDir })
    }
  }
  return skills
}

function isInstalledMarker(value: unknown): value is InstalledMarker {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as InstalledMarker).pluginId === 'string'
    && typeof (value as InstalledMarker).sha256 === 'string'
}

function readMarker(skill: RuntimeSkill | null): InstalledMarker | null {
  const marker = skill?.metadata?.installedBy
  return isInstalledMarker(marker) ? marker : null
}

function isUserEditedSkill(skill: RuntimeSkill | null): boolean {
  return skill?.metadata?.userEdited === true
}

function readSkillFiles(sourceDir: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(join(sourceDir, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = join(sourceDir, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSkillFiles(sourceDir, rel))
    } else if (entry.isFile()) {
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function buildRuntimeSkill(skill: { name: string; sourceDir: string }, marker: InstalledMarker): RuntimeSkill {
  const files = readSkillFiles(skill.sourceDir)
  return {
    name: skill.name,
    instructions: files['SKILL.md'] ?? '',
    files,
    metadata: { installedBy: marker },
  }
}

export async function scanPluginAssets(plugins: PluginEntry[]): Promise<ScanReport> {
  const report: ScanReport = {
    totalAvailable: 0,
    missing: [],
    drifted: [],
    installed: [],
    userEdited: [],
  }

  const runtime = getRuntimeAdapter()
  for (const plugin of plugins) {
    for (const skill of findSkillsForPlugin(plugin)) {
      report.totalAvailable++
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const installedSkill = await runtime.skills.get(skill.name)

      if (!installedSkill) {
        report.missing.push(ref)
        continue
      }

      if (isUserEditedSkill(installedSkill)) {
        report.userEdited.push(ref)
        continue
      }

      const sourceHash = sha256OfFile(join(skill.sourceDir, 'SKILL.md'))
      const marker = readMarker(installedSkill)
      if (marker && marker.sha256 === sourceHash) {
        report.installed.push(ref)
      } else {
        report.drifted.push(ref)
      }
    }
  }

  return report
}

export async function installPluginAssets(plugins: PluginEntry[]): Promise<InstallReport> {
  const report: InstallReport = { installed: [], unchanged: [], skipped: [] }
  const runtime = getRuntimeAdapter()

  for (const plugin of plugins) {
    for (const skill of findSkillsForPlugin(plugin)) {
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const sourceSkill = join(skill.sourceDir, 'SKILL.md')
      const sourceHash = sha256OfFile(sourceSkill)
      const installedSkill = await runtime.skills.get(skill.name)

      if (installedSkill && isUserEditedSkill(installedSkill)) {
        report.skipped.push({ ...ref, reason: 'userEdited' })
        log.warn('Skipping user-edited plugin skill', { name: skill.name, pluginId: plugin.id })
        continue
      }

      const marker = readMarker(installedSkill)
      if (installedSkill && marker && marker.sha256 === sourceHash) {
        report.unchanged.push(ref)
        continue
      }

      await runtime.skills.write(buildRuntimeSkill(skill, { pluginId: plugin.id, sha256: sourceHash }))
      report.installed.push(ref)
      log.info('Installed plugin skill', { name: skill.name, pluginId: plugin.id })
    }
  }

  // Sync lockfile installedSkills with what we just laid down. Without
  // this, skills installed via `bakin install plugin-assets` (the
  // onboarding component) would never appear in the lockfile allowlist
  // — and the C14 uninstall flow would silently leave them as orphans
  // because they wouldn't be in any plugin's `installedSkills`.
  syncLockfileInstalledSkills(plugins)

  return report
}

/**
 * Discover the set of plugin entries to scan. Defaults to the built-in
 * plugins from `bakin.config.ts` plus any user plugins under
 * `~/.bakin/plugins/`. Tests inject their own list directly.
 */
function discoverPlugins(): PluginEntry[] {
  const plugins: PluginEntry[] = []
  // Built-in plugins from bakin.config.ts. We require() it lazily so
  // onboarding can run before the bundler resolves the workspace.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../bakin.config') as Record<string, unknown>
    const cfg = (mod.default ?? mod) as { plugins?: Array<{ path: string; enabled?: boolean }> }
    for (const p of cfg.plugins ?? []) {
      if (p.enabled === false) continue
      const id = p.path.split('/').pop() || p.path
      plugins.push({ id, path: join(process.cwd(), p.path) })
    }
  } catch (err) {
    log.warn('Failed to read bakin.config for plugin discovery', { error: String(err) })
  }

  // User plugins under ~/.bakin/plugins/{id}/bakin-plugin.json
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getContentDir } = require('../content-dir') as typeof import('../content-dir')
    const userPluginsDir = join(getContentDir(), 'plugins')
    if (existsSync(userPluginsDir)) {
      for (const entry of readdirSync(userPluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifestPath = join(userPluginsDir, entry.name, 'bakin-plugin.json')
        if (!existsSync(manifestPath)) continue
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          plugins.push({ id: manifest.id || entry.name, path: join(userPluginsDir, entry.name) })
        } catch {
          /* skip malformed manifest */
        }
      }
    }
  } catch {
    /* getContentDir not available; skip user-plugin discovery */
  }

  return plugins
}

async function check(): Promise<CheckResult> {
  const plugins = discoverPlugins()
  const report = await scanPluginAssets(plugins)
  const pending = report.missing.length + report.drifted.length

  if (report.totalAvailable === 0) {
    return {
      name: 'plugin-assets',
      status: 'ok',
      message: '0 plugin assets to install (no plugin ships defaults/runtime-skills/)',
      details: { totalAvailable: 0 },
    }
  }

  if (pending === 0) {
    const userEditedNote = report.userEdited.length > 0
      ? ` (${report.userEdited.length} user-edited, locked)`
      : ''
    return {
      name: 'plugin-assets',
      status: 'ok',
      message: `All ${report.totalAvailable} plugin asset(s) installed${userEditedNote}`,
      details: report as unknown as Record<string, unknown>,
    }
  }

  return {
    name: 'plugin-assets',
    status: 'warn',
    message: `${pending} plugin asset(s) need install (${report.missing.length} missing, ${report.drifted.length} drifted)`,
    remediation: 'Run `bakin install plugin-assets` to apply.',
    details: report as unknown as Record<string, unknown>,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function install(_opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  const plugins = discoverPlugins()
  const report = await installPluginAssets(plugins)
  const durationMs = Date.now() - start

  if (report.installed.length === 0 && report.skipped.length === 0) {
    return {
      name: 'plugin-assets',
      status: 'noop',
      message: report.unchanged.length === 0
        ? '0 plugin assets to install'
        : `All ${report.unchanged.length} plugin asset(s) already up to date`,
      durationMs,
    }
  }

  const skippedNote = report.skipped.length > 0
    ? ` (skipped ${report.skipped.length} user-edited)`
    : ''
  return {
    name: 'plugin-assets',
    status: 'installed',
    message: `Installed ${report.installed.length} plugin asset(s)${skippedNote}`,
    durationMs,
  }
}

export const pluginAssetsComponent: OnboardingComponent = {
  name: 'plugin-assets',
  check,
  install,
}

/**
 * Reconcile the lockfile's per-plugin `installedSkills` field with what's
 * actually in `defaults/runtime-skills/` for each plugin entry. Best-
 * effort — failures are logged but never throw. Called from
 * `installPluginAssets` so the onboarding-driven install path keeps the
 * lockfile in sync with what was projected to the runtime skill store.
 *
 * Only touches lockfile entries that ALREADY exist (i.e., user plugins
 * that were installed via `bakin plugins install`). Core plugins have no
 * lockfile entry; they're skipped.
 *
 * Static-import (not lazy `require`) so test mocks targeting the
 * lockfile module actually intercept these calls. The previous lazy
 * require silently bypassed `mock.module` and the function ran against
 * the real production code path during tests — which then tripped the
 * content-dir safety guard and silently aborted via the swallow-all
 * catch below. The "circular import" the lazy form claimed to dodge
 * doesn't actually exist (lockfile only depends on content-dir).
 */
export function syncLockfileInstalledSkills(plugins: PluginEntry[]): void {
  let lock: PluginLockfile
  try {
    lock = readPluginLockfile()
  } catch (err) {
    log.warn('syncLockfileInstalledSkills: lockfile read failed', { err: String(err) })
    return
  }
  let mutated = false
  for (const plugin of plugins) {
    if (!lock.plugins[plugin.id]) continue
    const skillNames = findSkillsForPlugin(plugin).map(s => s.name).sort()
    const current = (lock.plugins[plugin.id].installedSkills ?? []).slice().sort()
    if (skillNames.length === current.length && skillNames.every((n, i) => n === current[i])) continue
    try {
      lock = updatePlugin(lock, plugin.id, { installedSkills: skillNames })
      mutated = true
    } catch (err) {
      log.warn('syncLockfileInstalledSkills: updatePlugin failed', { id: plugin.id, err: String(err) })
    }
  }
  if (mutated) {
    try {
      writePluginLockfile(lock)
    } catch (err) {
      log.warn('syncLockfileInstalledSkills: write failed', { err: String(err) })
    }
  }
}

// ─── Removal (#119) ──────────────────────────────────────────────────────────

export interface PluginAssetsRemovalPlan {
  /** Runtime skill names that will be removed. */
  toRemove: string[]
  /** Runtime skill names left in place because of `.userEdited`. */
  toKeep: string[]
  /**
   * Skills that the lockfile says this plugin installed but which are
   * not present (or no longer carry the matching .installedBy marker).
   * Surfaced for diagnostics; not deleted.
   */
  missingFromDisk: string[]
  /** Content snapshot for skills that will be removed, used by uninstall archives. */
  snapshots: PluginSkillSnapshot[]
}

export interface PluginSkillSnapshot {
  name: string
  files: Record<string, string>
}

/**
 * Ask the runtime to partition skills owned by `pluginId`
 * into "remove" vs "keep" (`.userEdited` locked).
 *
 * `ownedSkills` is the authoritative allowlist — the set of skill names
 * the LOCKFILE recorded this plugin installed at install/upgrade time.
 * A skill is only removable if it appears in BOTH the allowlist AND carries a
 * matching `.installedBy.pluginId` marker.
 *
 * This defeats the fake-marker scorched-earth attack (security HIGH #2):
 * a malicious plugin that writes `{pluginId: "evil"}` into a victim's
 * `.installedBy` cannot trick uninstall into deleting the victim's
 * skills, because the lockfile entry for "evil" never recorded
 * ownership of them.
 */
export async function planPluginAssetsRemoval(
  pluginId: string,
  ownedSkills: readonly string[],
): Promise<PluginAssetsRemovalPlan> {
  const runtime = getRuntimeAdapter()
  const plan: PluginAssetsRemovalPlan = { toRemove: [], toKeep: [], missingFromDisk: [], snapshots: [] }
  for (const skillName of ownedSkills) {
    const skill = await runtime.skills.get(skillName)
    if (!skill) {
      plan.missingFromDisk.push(skillName)
      continue
    }
    const marker = readMarker(skill)
    if (!marker || marker.pluginId !== pluginId) {
      // Lockfile claims ownership but the runtime marker disagrees —
      // either the plugin lost ownership (manual edit) or another plugin
      // overwrote it. Don't delete; surface as missing so operators can
      // investigate.
      plan.missingFromDisk.push(skillName)
      continue
    }
    if (isUserEditedSkill(skill)) {
      plan.toKeep.push(skillName)
    } else {
      plan.toRemove.push(skillName)
      plan.snapshots.push({
        name: skillName,
        files: skill.files ?? { 'SKILL.md': skill.instructions ?? '' },
      })
    }
  }
  return plan
}

/**
 * Tear down runtime skills owned by `pluginId`. Skips any skill with a
 * `.userEdited` sentinel and reports counts. Used by
 * `bakin plugins remove` (#119).
 *
 * `ownedSkills` is the lockfile-recorded allowlist — see
 * `planPluginAssetsRemoval` for the authority model.
 */
export async function removePluginAssets(
  pluginId: string,
  ownedSkills: readonly string[],
  existingPlan?: PluginAssetsRemovalPlan,
): Promise<{
  removed: number
  kept: number
  removedSkills: string[]
  keptSkills: string[]
  missingFromDisk: string[]
}> {
  const runtime = getRuntimeAdapter()
  const plan = existingPlan ?? await planPluginAssetsRemoval(pluginId, ownedSkills)
  for (const skillName of plan.toRemove) {
    await runtime.skills.remove(skillName)
    log.info('Removed runtime skill on plugin uninstall', { skillName, pluginId })
  }
  return {
    removed: plan.toRemove.length,
    kept: plan.toKeep.length,
    removedSkills: plan.toRemove,
    keptSkills: plan.toKeep,
    missingFromDisk: plan.missingFromDisk,
  }
}
