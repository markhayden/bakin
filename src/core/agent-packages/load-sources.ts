/**
 * Boot-time loader for agent-package contributions to the workflows source
 * registry + skill registry (Phase C-3).
 *
 * server.ts calls `loadAgentPackageSources()` after `pluginRegistry.initialize()`
 * has run — plugin-registered workflows + skills are already in place, so the
 * agent-package tier slots in beneath them and the user-on-disk tier (loaded
 * elsewhere) still wins on top.
 *
 * Failure mode: any error reading or parsing a single package's contributions
 * gets logged and skipped. Boot must not fail because of one corrupted lockfile
 * entry — the doctor sweep is the right place to surface those.
 *
 * V1 scope:
 *   - workflows: parse each contributions.workflows YAML file → call
 *     registerAgentPackageDefinition(packageId, definitionId, definition)
 *   - workflow-skills: parse each contributions.workflowSkills markdown
 *     file → call registerAgentPackageSkill(packageId, name, skill)
 *
 * Knowledge file indexing for search (CC-2 in PLAN.md) lands in Phase F-4
 * via the team plugin's existing `registerFileBackedContentType` helper —
 * not this module.
 *
 * Skill projection into the runtime's workspace/global skill stores is
 * the installer's job (Phase E-3), not this module — by the time we get
 * here, those files are already on disk. We only populate the in-memory
 * registries so workflow runtime can resolve references.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import yaml from 'js-yaml'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import {
  type Lockfile,
  type PackageEntry,
  readLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  registerAgentPackageDefinition,
  unregisterAgentPackageDefinitions,
} from '../../../plugins/workflows/lib/source-registry'
import {
  registerAgentPackageSkill,
  unregisterAgentPackageSkills,
} from '../../../plugins/workflows/lib/agent-package-skill-registry'
import type { WorkflowDefinition } from '../../../plugins/workflows/types'
import type { SkillDefinition } from '../../../packages/core/src/plugin-types'

const log = createLogger('agent-pkg:load-sources')

export interface LoadSourcesResult {
  /** Top-level package ids whose contributions we touched. */
  packagesProcessed: string[]
  /** Number of workflow definitions registered into the source registry. */
  workflowsRegistered: number
  /** Number of workflow-skills registered. */
  skillsRegistered: number
  /** Per-package warnings (malformed YAML, missing file, etc.). */
  warnings: { packageId: string; message: string }[]
}

interface ManifestSnapshot {
  contributions?: {
    workflows?: string[]
    workflowSkills?: string[]
  }
}

/**
 * Read the package's bakin-package.json from the install dir. Returns null
 * if missing or malformed — callers should warn and skip rather than crash.
 */
function readPackageManifest(packageDir: string): ManifestSnapshot | null {
  const manifestPath = join(packageDir, 'bakin-package.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestSnapshot
  } catch {
    return null
  }
}

/** Stable id for a workflow definition: explicit `id`, fallback to slugged name. */
function deriveWorkflowId(definition: WorkflowDefinition, fallbackBase: string): string {
  if (typeof definition.id === 'string' && definition.id.length > 0) return definition.id
  if (typeof definition.name === 'string' && definition.name.length > 0) {
    return definition.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .replace(/-$/, '')
  }
  return fallbackBase
}

interface ParsedSkill {
  frontmatter: Record<string, unknown>
  body: string
}

function parseSkillFile(content: string): ParsedSkill {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content.trim() }
  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {}
  } catch {
    return { frontmatter: {}, body: content.trim() }
  }
  return { frontmatter, body: match[2].trim() }
}

function loadWorkflowsForPackage(
  packageId: string,
  packageDir: string,
  workflows: string[],
  result: LoadSourcesResult,
): void {
  for (const rel of workflows) {
    const abs = join(packageDir, rel)
    if (!existsSync(abs)) {
      result.warnings.push({ packageId, message: `workflow file missing: ${rel}` })
      continue
    }
    let definition: WorkflowDefinition
    try {
      const yamlText = readFileSync(abs, 'utf-8')
      definition = yaml.load(yamlText) as WorkflowDefinition
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.warnings.push({ packageId, message: `failed to parse ${rel}: ${message}` })
      continue
    }
    if (!definition || typeof definition !== 'object') {
      result.warnings.push({ packageId, message: `${rel} did not yield an object` })
      continue
    }
    const fallback = basename(rel).replace(/\.(yaml|yml)$/i, '')
    const id = deriveWorkflowId(definition, fallback)
    try {
      registerAgentPackageDefinition(packageId, id, definition)
      result.workflowsRegistered++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.warnings.push({ packageId, message: `register workflow ${id}: ${message}` })
    }
  }
}

function loadWorkflowSkillsForPackage(
  packageId: string,
  packageDir: string,
  workflowSkills: string[],
  result: LoadSourcesResult,
): void {
  for (const rel of workflowSkills) {
    const abs = join(packageDir, rel)
    if (!existsSync(abs)) {
      result.warnings.push({ packageId, message: `workflow-skill file missing: ${rel}` })
      continue
    }
    let raw: string
    try {
      raw = readFileSync(abs, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.warnings.push({ packageId, message: `read ${rel}: ${message}` })
      continue
    }
    const { frontmatter, body } = parseSkillFile(raw)
    const filenameId = basename(rel).replace(/\.md$/i, '')
    const skill: SkillDefinition = {
      name: (frontmatter.name as string) || filenameId,
      instructions: body,
    }
    if (frontmatter.output_schema) {
      skill.output_schema = frontmatter.output_schema as Record<string, unknown>
    }
    try {
      registerAgentPackageSkill(packageId, filenameId, skill)
      result.skillsRegistered++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.warnings.push({ packageId, message: `register skill ${filenameId}: ${message}` })
    }
  }
}

/** Strip a compound `<id>@<version>` lockfile key down to the bare id. */
function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

function loadSourcesForEntry(
  packageId: string,
  entry: PackageEntry,
  contentDir: string,
  result: LoadSourcesResult,
): void {
  // Lockfile keys for non-agent kinds are compound (`<id>@<version>`);
  // package-paths takes the bare id + version separately, and the workflow
  // source registry indexes by bare id so cross-package references stay
  // version-agnostic.
  const bareId = entry.kind === 'agent' ? packageId : stripVersionFromKey(packageId)
  const packageDir = getPackageSourceDir(contentDir, entry.kind, bareId, entry.version)
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
    result.warnings.push({
      packageId,
      message: `package source dir missing: ${packageDir}`,
    })
    return
  }
  const manifest = readPackageManifest(packageDir)
  if (!manifest) {
    result.warnings.push({
      packageId,
      message: `bakin-package.json missing or malformed in ${packageDir}`,
    })
    return
  }

  // Wipe prior registrations for this package id so re-runs are idempotent
  // (server boot, post-install reload, etc.). Use bare id so registry refs
  // stay version-agnostic; the lockfile is the source of truth for which
  // version is actually installed.
  unregisterAgentPackageDefinitions(bareId)
  unregisterAgentPackageSkills(bareId)

  const workflows = manifest.contributions?.workflows ?? []
  if (workflows.length > 0) {
    loadWorkflowsForPackage(bareId, packageDir, workflows, result)
  }
  const workflowSkills = manifest.contributions?.workflowSkills ?? []
  if (workflowSkills.length > 0) {
    loadWorkflowSkillsForPackage(bareId, packageDir, workflowSkills, result)
  }

  result.packagesProcessed.push(packageId)
}

/**
 * Boot-time entry point. Reads the lockfile and registers every installed
 * package's workflow + workflow-skill contributions.
 *
 * @param contentDir Override for tests; production callers pass `getContentDir()`.
 */
export function loadAgentPackageSources(contentDir: string = getContentDir()): LoadSourcesResult {
  const result: LoadSourcesResult = {
    packagesProcessed: [],
    workflowsRegistered: 0,
    skillsRegistered: 0,
    warnings: [],
  }

  let lockfile: Lockfile
  try {
    lockfile = readLockfile()
  } catch (err) {
    log.warn('Lockfile unreadable — skipping agent-package source load', {
      error: err instanceof Error ? err.message : String(err),
    })
    return result
  }

  for (const [packageId, entry] of Object.entries(lockfile.packages)) {
    // Only kinds that contribute workflows/workflow-skills get scanned.
    // skill-packs ship runtime skills (filesystem) but no workflow content;
    // knowledge-packs ship knowledge files (search-indexed elsewhere).
    if (entry.kind !== 'agent' && entry.kind !== 'workflow-pack') continue
    try {
      loadSourcesForEntry(packageId, entry, contentDir, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.warnings.push({ packageId, message: `load failed: ${message}` })
    }
  }

  if (result.packagesProcessed.length > 0 || result.warnings.length > 0) {
    log.info('Loaded agent-package sources', {
      packages: result.packagesProcessed.length,
      workflows: result.workflowsRegistered,
      skills: result.skillsRegistered,
      warnings: result.warnings.length,
    })
  }

  for (const w of result.warnings) {
    log.warn(`agent-package "${w.packageId}": ${w.message}`)
  }

  return result
}
