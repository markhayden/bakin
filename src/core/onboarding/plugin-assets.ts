/**
 * plugin-assets onboarding component (S-B in the workflows-plugin spec).
 *
 * Plugins ship OpenClaw runtime skill packages at
 * `defaults/openclaw-skills/{name}/SKILL.md` (+ optional `scripts/`,
 * other sibling files). This component installs them under
 * `~/.openclaw/skills/{name}/` so OpenClaw agents can invoke them.
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
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { createLogger } from '../logger'
import { getOpenClawPath } from '../../../packages/core/src/openclaw-home'
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
 * Walk a plugin's `defaults/openclaw-skills/*` directories and return
 * one entry per skill that has a `SKILL.md`. Skills are 1 directory deep.
 */
function findSkillsForPlugin(plugin: PluginEntry): Array<{ name: string; sourceDir: string }> {
  const skillsRoot = join(plugin.path, 'defaults', 'openclaw-skills')
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

function installedSkillDir(name: string): string {
  return getOpenClawPath('skills', name)
}

function readMarker(skillDir: string): InstalledMarker | null {
  const markerPath = join(skillDir, '.installedBy')
  if (!existsSync(markerPath)) return null
  try {
    return JSON.parse(readFileSync(markerPath, 'utf-8')) as InstalledMarker
  } catch {
    return null
  }
}

function writeMarker(skillDir: string, marker: InstalledMarker): void {
  writeFileSync(join(skillDir, '.installedBy'), JSON.stringify(marker, null, 2))
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const dstPath = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyTree(srcPath, dstPath)
    } else if (entry.isFile()) {
      mkdirSync(dirname(dstPath), { recursive: true })
      copyFileSync(srcPath, dstPath)
    }
  }
}

export function scanPluginAssets(plugins: PluginEntry[]): ScanReport {
  const report: ScanReport = {
    totalAvailable: 0,
    missing: [],
    drifted: [],
    installed: [],
    userEdited: [],
  }

  for (const plugin of plugins) {
    for (const skill of findSkillsForPlugin(plugin)) {
      report.totalAvailable++
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const installedDir = installedSkillDir(skill.name)
      const installedSkill = join(installedDir, 'SKILL.md')

      if (!existsSync(installedSkill)) {
        report.missing.push(ref)
        continue
      }

      if (existsSync(join(installedDir, '.userEdited'))) {
        report.userEdited.push(ref)
        continue
      }

      const sourceHash = sha256OfFile(join(skill.sourceDir, 'SKILL.md'))
      const marker = readMarker(installedDir)
      if (marker && marker.sha256 === sourceHash) {
        report.installed.push(ref)
      } else {
        report.drifted.push(ref)
      }
    }
  }

  return report
}

export function installPluginAssets(plugins: PluginEntry[]): InstallReport {
  const report: InstallReport = { installed: [], unchanged: [], skipped: [] }

  for (const plugin of plugins) {
    for (const skill of findSkillsForPlugin(plugin)) {
      const ref: SkillRef = { pluginId: plugin.id, name: skill.name }
      const installedDir = installedSkillDir(skill.name)
      const installedSkill = join(installedDir, 'SKILL.md')
      const sourceSkill = join(skill.sourceDir, 'SKILL.md')
      const sourceHash = sha256OfFile(sourceSkill)

      if (existsSync(installedSkill) && existsSync(join(installedDir, '.userEdited'))) {
        report.skipped.push({ ...ref, reason: 'userEdited' })
        log.warn('Skipping user-edited plugin skill', { name: skill.name, pluginId: plugin.id })
        continue
      }

      const marker = readMarker(installedDir)
      if (existsSync(installedSkill) && marker && marker.sha256 === sourceHash) {
        report.unchanged.push(ref)
        continue
      }

      copyTree(skill.sourceDir, installedDir)
      writeMarker(installedDir, { pluginId: plugin.id, sha256: sourceHash })
      report.installed.push(ref)
      log.info('Installed plugin skill', { name: skill.name, pluginId: plugin.id })
    }
  }

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
  const report = scanPluginAssets(plugins)
  const pending = report.missing.length + report.drifted.length

  if (report.totalAvailable === 0) {
    return {
      name: 'plugin-assets',
      status: 'ok',
      message: '0 plugin assets to install (no plugin ships defaults/openclaw-skills/)',
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
  const report = installPluginAssets(plugins)
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

// ─── Removal (#119) ──────────────────────────────────────────────────────────

export interface PluginAssetsRemovalPlan {
  /** Absolute paths of skill dirs that will be removed. */
  toRemove: string[]
  /** Absolute paths of skill dirs left in place because of `.userEdited`. */
  toKeep: string[]
}

/**
 * Walk `~/.openclaw/skills/` and partition every skill dir whose
 * `.installedBy.pluginId` matches into "remove" vs "keep" (the latter
 * being skills locked by a `.userEdited` sentinel).
 *
 * Returns a plan WITHOUT touching the filesystem so the caller can
 * snapshot the to-remove dirs into the .uninstalled tarball before
 * deleting them.
 */
export function planPluginAssetsRemoval(pluginId: string): PluginAssetsRemovalPlan {
  const skillsRoot = getOpenClawPath('skills')
  const plan: PluginAssetsRemovalPlan = { toRemove: [], toKeep: [] }
  if (!existsSync(skillsRoot)) return plan
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsRoot, entry.name)
    const marker = readMarker(skillDir)
    if (!marker || marker.pluginId !== pluginId) continue
    if (existsSync(join(skillDir, '.userEdited'))) {
      plan.toKeep.push(skillDir)
    } else {
      plan.toRemove.push(skillDir)
    }
  }
  return plan
}

/**
 * Tear down OpenClaw skills owned by `pluginId`. Skips any skill with a
 * `.userEdited` sentinel and reports both counts. Used by
 * `bakin plugins remove` (#119).
 *
 * Returns counts (and the filesystem paths) so the remove orchestration
 * can render the spec'd "Cleaned N skills, kept M user-edited" output
 * without re-walking the filesystem.
 */
export async function removePluginAssets(pluginId: string): Promise<{
  removed: number
  kept: number
  removedDirs: string[]
  keptDirs: string[]
}> {
  const plan = planPluginAssetsRemoval(pluginId)
  for (const dir of plan.toRemove) {
    rmSync(dir, { recursive: true, force: true })
    log.info('Removed OpenClaw skill on plugin uninstall', { dir, pluginId })
  }
  return {
    removed: plan.toRemove.length,
    kept: plan.toKeep.length,
    removedDirs: plan.toRemove,
    keptDirs: plan.toKeep,
  }
}
