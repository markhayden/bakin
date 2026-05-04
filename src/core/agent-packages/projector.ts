/**
 * Projector — writes a package's contributions onto disk.
 *
 * This is the side-effecting half of an install. The pure halves —
 * manifest validation, lockfile mutators, marker primitives — already
 * landed in earlier phases. The projector consumes a parsed manifest
 * plus a staging directory and produces:
 *
 *   - workspace files through the runtime adapter
 *     (fresh mode only; update mode honors --refresh-template; adopt
 *      mode skips entirely)
 *   - skills in the runtime's agent-scoped or global skill store
 *   - assets at ~/.bakin/agents/<agentId>/<file>
 *   - lesson markers injected into the agent's SOUL.md (catalog +
 *     per-enabled-lesson blocks)
 *
 * Each successful write goes into an in-memory `writeLog` so any later
 * failure can roll back. Rollback restores the file's prior contents
 * (or removes the file if it didn't exist before). Sidecar markers
 * (.installedBy) are part of the same atomic group — if the projection
 * fails, the sidecars come back too.
 *
 * `.userEdited` sentinels are honored unconditionally — if a target file
 * has one, the projector skips it (records a SkippedEntry) and never
 * rolls it back to a different content. The user opted into local
 * ownership; Bakin steps back.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join, basename } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { getAppServices } from '../app-services'
import type { RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'
import {
  type AgentManifest,
  type Manifest,
  type SkillPackManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  type ProjectionEntry,
} from '../../../packages/core/src/agent-packages/lockfile'
import {
  computeDirSha,
  computeFileSha,
  type InstalledByMarker,
  installedByPath,
  isUserEdited,
  readInstalledBy,
  removeInstalledBy,
  writeInstalledBy,
} from '../../../packages/core/src/agent-packages/markers'
import {
  injectBlock,
  removeBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'
import { validatePackageLessonIntegrity } from './lesson-integrity'

const log = createLogger('agent-pkg:project')

// ─── Public API ──────────────────────────────────────────────────────────────

export type ProjectionMode = 'fresh' | 'adopt' | 'update'

export interface ProjectorOptions {
  /** Parsed manifest — already zod-validated by the caller. */
  manifest: Manifest
  /** Where the package source lives on disk (from source-fetcher). */
  stagingDir: string
  /** Required for kind:"agent". For other kinds, leave undefined. */
  agentId?: string
  /** Install mode — see top-of-file doc. */
  mode: ProjectionMode
  /** When true, update mode rewrites workspace files even if they exist. */
  refreshTemplate?: boolean
  /** Lesson ids to enable on this projection. Defaults to manifest.install.enableLessons. */
  enabledLessons?: string[]
  /** Provenance metadata stamped onto every .installedBy sidecar. */
  installedBy: Omit<InstalledByMarker, 'sha256'>
  /**
   * When true, allow overwriting projection targets owned by a DIFFERENT
   * package. Default: refuse (throw with the conflicting package id).
   * The CLI / REST surface threads `--replace` here; manifest-declared
   * `installAs` aliases sidestep collisions by retargeting the
   * projection at a different filesystem path entirely (no overlap to
   * resolve).
   */
  replace?: boolean
}

export interface SkippedEntry {
  /** Absolute path of the projection target that was skipped. */
  target: string
  reason: 'userEdited'
}

export interface ProjectorResult {
  projections: ProjectionEntry[]
  skipped: SkippedEntry[]
}

// ─── Internal write log (for rollback) ───────────────────────────────────────

type WriteOp =
  | { kind: 'created-file'; path: string }
  | { kind: 'modified-file'; path: string; previousContent: string }
  | { kind: 'created-dir'; path: string }
  | { kind: 'created-tree'; path: string }
  | { kind: 'created-workspace-file'; agentId: string; path: string }
  | { kind: 'modified-workspace-file'; agentId: string; previous: WorkspaceFile }
  | { kind: 'created-skill'; name: string; agentId?: string }
  | { kind: 'modified-skill'; name: string; previous: RuntimeSkill; agentId?: string }

class WriteLog {
  private readonly ops: WriteOp[] = []

  recordCreatedFile(path: string): void {
    this.ops.push({ kind: 'created-file', path })
  }

  recordModifiedFile(path: string, previousContent: string): void {
    this.ops.push({ kind: 'modified-file', path, previousContent })
  }

  recordCreatedDir(path: string): void {
    this.ops.push({ kind: 'created-dir', path })
  }

  recordCreatedTree(path: string): void {
    this.ops.push({ kind: 'created-tree', path })
  }

  recordCreatedWorkspaceFile(agentId: string, path: string): void {
    this.ops.push({ kind: 'created-workspace-file', agentId, path })
  }

  recordModifiedWorkspaceFile(agentId: string, previous: WorkspaceFile): void {
    this.ops.push({ kind: 'modified-workspace-file', agentId, previous })
  }

  recordCreatedSkill(name: string, agentId?: string): void {
    this.ops.push({ kind: 'created-skill', name, agentId })
  }

  recordModifiedSkill(name: string, previous: RuntimeSkill, agentId?: string): void {
    this.ops.push({ kind: 'modified-skill', name, previous, agentId })
  }

  /** Roll back every op in reverse order. Best-effort — log failures. */
  async rollback(): Promise<void> {
    const runtime = getAppServices().runtime
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]
      try {
        switch (op.kind) {
          case 'created-file':
            if (existsSync(op.path)) unlinkSync(op.path)
            break
          case 'modified-file':
            writeFileSync(op.path, op.previousContent, 'utf-8')
            break
          case 'created-dir':
            if (existsSync(op.path)) {
              try {
                rmSync(op.path, { recursive: false, force: false })
              } catch {
                // Directory may have content from another op we haven't rolled
                // back yet. Will retry on next pass — current best-effort.
              }
            }
            break
          case 'created-tree':
            if (existsSync(op.path)) rmSync(op.path, { recursive: true, force: true })
            break
          case 'created-workspace-file':
            await runtime.agents.removeWorkspaceFile(op.agentId, op.path)
            break
          case 'modified-workspace-file':
            await runtime.agents.writeWorkspaceFile(op.agentId, op.previous)
            break
          case 'created-skill':
            await runtime.skills.remove(op.name, op.agentId)
            break
          case 'modified-skill':
            await runtime.skills.write(op.previous, op.agentId)
            break
        }
      } catch (err) {
        log.warn('Rollback step failed', {
          op: op.kind,
          path: 'path' in op ? op.path : 'name' in op ? op.name : op.previous.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

// ─── Filesystem primitives ───────────────────────────────────────────────────

function ensureDir(absDir: string, log: WriteLog): void {
  if (existsSync(absDir)) return
  mkdirSync(absDir, { recursive: true })
  log.recordCreatedDir(absDir)
}

function readSourceTree(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSourceTree(root, rel))
    } else if (entry.isFile()) {
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function runtimeWorkspaceTarget(agentId: string, path: string): string {
  return `runtime:workspace-file:${encodeURIComponent(agentId)}:${encodeURIComponent(path)}`
}

function runtimeSkillTarget(name: string, agentId?: string): string {
  return agentId
    ? `runtime:agent-skill:${encodeURIComponent(agentId)}:${encodeURIComponent(name)}`
    : `runtime:global-skill:${encodeURIComponent(name)}`
}

type RuntimeProjectionTarget =
  | { kind: 'workspace-file'; agentId: string; path: string }
  | { kind: 'agent-skill'; agentId: string; name: string }
  | { kind: 'global-skill'; name: string }

function parseRuntimeTarget(target: string): RuntimeProjectionTarget | null {
  const parts = target.split(':')
  if (parts[0] !== 'runtime') return null
  if (parts[1] === 'workspace-file' && parts.length === 4) {
    return { kind: 'workspace-file', agentId: decodeURIComponent(parts[2]), path: decodeURIComponent(parts[3]) }
  }
  if (parts[1] === 'agent-skill' && parts.length === 4) {
    return { kind: 'agent-skill', agentId: decodeURIComponent(parts[2]), name: decodeURIComponent(parts[3]) }
  }
  if (parts[1] === 'global-skill' && parts.length === 3) {
    return { kind: 'global-skill', name: decodeURIComponent(parts[2]) }
  }
  return null
}

function isInstalledByMarker(value: unknown): value is InstalledByMarker {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as InstalledByMarker).package === 'string'
    && typeof (value as InstalledByMarker).sha256 === 'string'
}

function runtimeInstalledBy(skill: RuntimeSkill | null): InstalledByMarker | null {
  const marker = skill?.metadata?.installedBy
  return isInstalledByMarker(marker) ? marker : null
}

// ─── Workspace files ─────────────────────────────────────────────────────────

async function projectWorkspaceFiles(
  manifest: AgentManifest,
  agentId: string,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): Promise<void> {
  const files = manifest.contributions.workspaceFiles ?? []
  if (files.length === 0) return

  const runtime = getAppServices().runtime

  for (const rel of files) {
    const src = join(options.stagingDir, rel)
    if (!existsSync(src)) {
      log.warn('Workspace-file source missing — skipping', { rel })
      continue
    }
    // Workspace files land at the workspace root with the file's basename,
    // ignoring intermediate directories in the package source. The package
    // ships them under workspace/SOUL.md but they project as just SOUL.md.
    const filename = basename(rel)
    const target = runtimeWorkspaceTarget(agentId, filename)
    const existing = await runtime.agents.readWorkspaceFile(agentId, filename)

    if (existing?.metadata?.userEdited === true) {
      result.skipped.push({ target, reason: 'userEdited' })
      continue
    }

    // Adopt mode: never write workspace template files.
    if (options.mode === 'adopt') continue

    // Update mode: only rewrite when --refresh-template is requested.
    if (options.mode === 'update' && !options.refreshTemplate) continue

    if (existing) {
      writeLog.recordModifiedWorkspaceFile(agentId, existing)
    } else {
      writeLog.recordCreatedWorkspaceFile(agentId, filename)
    }

    const body = readFileSync(src, 'utf-8')
    const sha256 = computeFileSha(src)
    const marker: InstalledByMarker = { ...options.installedBy, sha256 }
    await runtime.agents.writeWorkspaceFile(agentId, {
      path: filename,
      content: body,
      metadata: { installedBy: marker },
    })
    result.projections.push({
      kind: 'workspace-file',
      target,
      sha256,
      templateOnly: true,
    })
  }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

async function projectSkills(
  manifest: AgentManifest | SkillPackManifest,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): Promise<void> {
  const skillRels =
    manifest.kind === 'agent'
      ? (manifest.contributions.skills ?? [])
      : manifest.contributions.skills

  if (skillRels.length === 0) return

  const runtime = getAppServices().runtime

  for (const rel of skillRels) {
    const src = join(options.stagingDir, rel)
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      log.warn('Skill source missing or not a directory — skipping', { rel })
      continue
    }
    const skillName = basename(rel)
    const scopedAgentId = manifest.kind === 'agent' ? options.agentId : undefined
    if (manifest.kind === 'agent' && !scopedAgentId) {
      throw new Error('agentId required for kind:"agent" skill projection')
    }
    const target = runtimeSkillTarget(skillName, scopedAgentId)
    const existingSkill = await runtime.skills.get(skillName, scopedAgentId)

    if (existingSkill?.metadata?.userEdited === true) {
      result.skipped.push({ target, reason: 'userEdited' })
      continue
    }

    // Skills always project on fresh + update; adopt mode also installs
    // skills (the user opted into the package's capabilities).
    const targetExisted = existingSkill !== null

    // Collision check: if the target already has a sidecar pointing at a
    // DIFFERENT package, refuse unless --replace was passed. This is the
    // primary collision path for global runtime skills where
    // two skill-packs could both ship the same skill name.
    if (targetExisted) {
      const existingMarker = runtimeInstalledBy(existingSkill)
      if (
        existingMarker
        && existingMarker.package !== options.installedBy.package
        && !options.replace
      ) {
        throw new Error(
          `Projection collision at ${target}: already owned by package "${existingMarker.package}" `
          + `(would be replaced by "${options.installedBy.package}"). Resolve via the manifest's `
          + `dependencies[].installAs alias, or pass --replace to overwrite.`,
        )
      }
      writeLog.recordModifiedSkill(skillName, existingSkill!, scopedAgentId)
    }

    if (!targetExisted) {
      writeLog.recordCreatedSkill(skillName, scopedAgentId)
    }

    const files = readSourceTree(src)
    const sha256 = computeDirSha(src)
    await runtime.skills.write({
      name: skillName,
      instructions: files['SKILL.md'] ?? '',
      files,
      metadata: { installedBy: { ...options.installedBy, sha256 } },
    }, scopedAgentId)

    result.projections.push({ kind: 'skill', target, sha256 })
  }
}

// ─── Assets (per-agent UI files: avatars, etc.) ──────────────────────────────

function projectAssets(
  manifest: Manifest,
  agentId: string | undefined,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): void {
  if (manifest.kind !== 'agent') return // only agent packages project per-agent UI assets
  if (!agentId) return

  const assets = manifest.contributions.assets ?? []
  if (assets.length === 0) return

  const bakinAgentDir = join(getContentDir(), 'agents', agentId)

  for (const rel of assets) {
    const src = join(options.stagingDir, rel)
    if (!existsSync(src)) {
      log.warn('Asset source missing — skipping', { rel })
      continue
    }
    const target = join(bakinAgentDir, basename(rel))

    if (isUserEdited(target)) {
      result.skipped.push({ target, reason: 'userEdited' })
      continue
    }

    ensureDir(dirname(target), writeLog)
    const targetExisted = existsSync(target)
    if (targetExisted) {
      // Same collision policy as skills — different package's existing
      // asset refuses unless --replace.
      const existingMarker = readInstalledBy(target)
      if (
        existingMarker
        && existingMarker.package !== options.installedBy.package
        && !options.replace
      ) {
        throw new Error(
          `Projection collision at ${target}: already owned by package "${existingMarker.package}" `
          + `(would be replaced by "${options.installedBy.package}"). Resolve via the manifest's `
          + `dependencies[].installAs alias, or pass --replace to overwrite.`,
        )
      }
      const prev = readFileSync(target)
      copyFileSync(src, target)
      writeLog.recordModifiedFile(target, prev.toString('binary'))
    } else {
      copyFileSync(src, target)
      writeLog.recordCreatedFile(target)
    }

    const sha256 = computeFileSha(target)
    writeInstalledBy(target, { ...options.installedBy, sha256 })
    writeLog.recordCreatedFile(installedByPath(target))

    result.projections.push({ kind: 'asset', target, sha256 })
  }
}

// ─── Lesson markers (SOUL.md catalog + per-lesson blocks) ────────────────────

interface LessonFileMeta {
  lessonId: string
  title: string
  body: string
  defaultEnabled: boolean
  packageRel: string
}

function parseLessonFile(absPath: string, packageRel: string): LessonFileMeta {
  const raw = readFileSync(absPath, 'utf-8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  let title = basename(absPath).replace(/\.md$/i, '')
  let defaultEnabled = false
  let body = raw.trim()

  if (match) {
    body = match[2].trim()
    // Light frontmatter parse — we only need title + defaultEnabled, and
    // bringing in js-yaml here pulls a heavy dep into the projector. The
    // installer is the right place for full frontmatter access.
    for (const line of match[1].split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('title:')) {
        title = trimmed.slice('title:'.length).trim().replace(/^['"]|['"]$/g, '')
      } else if (trimmed.startsWith('defaultEnabled:')) {
        defaultEnabled = trimmed.slice('defaultEnabled:'.length).trim() === 'true'
      }
    }
  }

  const lessonId = basename(absPath).replace(/\.md$/i, '')
  return { lessonId, title, body, defaultEnabled, packageRel }
}

function readLessonFiles(
  manifest: AgentManifest,
  options: ProjectorOptions,
): LessonFileMeta[] {
  const rels = manifest.contributions.lessons ?? []
  const out: LessonFileMeta[] = []
  for (const rel of rels) {
    const abs = join(options.stagingDir, rel)
    if (!existsSync(abs)) {
      log.warn('Lesson source missing — skipping', { rel })
      continue
    }
    out.push(parseLessonFile(abs, rel))
  }
  return out
}

function lessonBlockId(packageId: string, lessonId: string): string {
  return `lesson:${packageId}:${lessonId}`
}

const CATALOG_BLOCK_ID = 'lesson-catalog'

function buildCatalogBody(
  packageId: string,
  lessons: LessonFileMeta[],
  enabled: Set<string>,
): string {
  if (lessons.length === 0) {
    return `> No lessons available from ${packageId}.`
  }
  const lines = [
    `> Lessons available from agent-package \`${packageId}\`. ` +
      `Toggle individual lessons via \`bakin agents lessons enable|disable\`.`,
    '',
  ]
  for (const k of lessons) {
    const mark = enabled.has(k.lessonId) ? '[x]' : '[ ]'
    lines.push(`- ${mark} **${k.title}** (\`${k.lessonId}\`)`)
  }
  return lines.join('\n')
}

async function projectLessonMarkers(
  manifest: AgentManifest,
  agentId: string,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): Promise<void> {
  const runtime = getAppServices().runtime
  const soulPath = runtimeWorkspaceTarget(agentId, 'SOUL.md')
  const soulFile = await runtime.agents.readWorkspaceFile(agentId, 'SOUL.md')
  if (!soulFile) {
    // Adopt mode without an existing SOUL.md is unusual but possible if
    // the user pre-created the agent and never wrote SOUL.md. Skip with
    // a warning — the doctor will surface it.
    log.warn('SOUL.md missing — lesson markers skipped', { soulPath })
    return
  }

  if (soulFile.metadata?.userEdited === true) {
    result.skipped.push({ target: soulPath, reason: 'userEdited' })
    return
  }

  const lessons = readLessonFiles(manifest, options)
  const enabledList = options.enabledLessons
    ?? manifest.install.enableLessons
    ?? lessons.filter((k) => k.defaultEnabled).map((k) => k.lessonId)
  const enabled = new Set(enabledList)

  const before = soulFile.content
  let updated = before

  // 1. Catalog block — always written, lists every available lesson with
  //    its enabled state.
  updated = injectBlock(
    updated,
    CATALOG_BLOCK_ID,
    buildCatalogBody(manifest.id, lessons, enabled),
  )

  // 2. Per-lesson blocks — present only for enabled lessons. Disabled
  //    lessons get their block removed (handles the toggle-off path).
  for (const k of lessons) {
    const blockId = lessonBlockId(manifest.id, k.lessonId)
    if (enabled.has(k.lessonId)) {
      updated = injectBlock(updated, blockId, k.body)
    } else {
      updated = removeBlock(updated, blockId)
    }
  }

  if (updated !== before) {
    writeLog.recordModifiedWorkspaceFile(agentId, soulFile)
    await runtime.agents.writeWorkspaceFile(agentId, {
      path: 'SOUL.md',
      content: updated,
      metadata: soulFile.metadata,
    })
  }

  // Record one projection entry for the catalog plus one per enabled lesson.
  result.projections.push({
    kind: 'lesson-marker',
    target: soulPath,
    blockId: CATALOG_BLOCK_ID,
  })
  for (const k of lessons) {
    if (!enabled.has(k.lessonId)) continue
    result.projections.push({
      kind: 'lesson-marker',
      target: soulPath,
      blockId: lessonBlockId(manifest.id, k.lessonId),
    })
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Project a parsed package's contributions onto disk. Atomic at the
 * package level: any error rolls back every successful write before
 * re-throwing so the install state matches what was on disk before.
 */
export async function projectPackage(options: ProjectorOptions): Promise<ProjectorResult> {
  validatePackageLessonIntegrity({
    manifest: options.manifest,
    stagingDir: options.stagingDir,
    enabledLessons: options.enabledLessons,
  })

  const result: ProjectorResult = { projections: [], skipped: [] }
  const writeLog = new WriteLog()

  try {
    if (options.manifest.kind === 'agent') {
      if (!options.agentId) {
        throw new Error('agentId required for kind:"agent" projection')
      }
      await projectWorkspaceFiles(options.manifest, options.agentId, options, result, writeLog)
      await projectSkills(options.manifest, options, result, writeLog)
      projectAssets(options.manifest, options.agentId, options, result, writeLog)
      await projectLessonMarkers(options.manifest, options.agentId, options, result, writeLog)
    } else if (options.manifest.kind === 'skill-pack') {
      await projectSkills(options.manifest, options, result, writeLog)
    }
    // workflow-pack and lesson-pack don't project filesystem-side at
    // V1 — workflow-pack lives in the source registry (boot-time load),
    // lesson-pack is search-indexed by the team plugin. Their
    // package source dir under ~/.bakin/packages/* is the only "projection."
  } catch (err) {
    await writeLog.rollback()
    throw err
  }

  return result
}

/**
 * Reverse a projection — used by the uninstaller (Phase E-6). Removes
 * every projected file (skipping `.userEdited` ones), removes sidecars,
 * and strips lesson markers from SOUL.md.
 */
export async function unprojectPackage(
  projections: ProjectionEntry[],
  options: { keepBlocks?: boolean } = {},
): Promise<void> {
  const runtime = getAppServices().runtime
  for (const p of projections) {
    const runtimeTarget = parseRuntimeTarget(p.target)
    if (p.kind === 'lesson-marker') {
      if (options.keepBlocks) continue
      if (!runtimeTarget || runtimeTarget.kind !== 'workspace-file') continue
      const file = await runtime.agents.readWorkspaceFile(runtimeTarget.agentId, runtimeTarget.path)
      if (!file || file.metadata?.userEdited === true) continue
      const before = file.content
      const after = removeBlock(before, p.blockId ?? '')
      if (after !== before) {
        await runtime.agents.writeWorkspaceFile(runtimeTarget.agentId, {
          ...file,
          content: after,
        })
      }
      continue
    }
    if (runtimeTarget?.kind === 'workspace-file') {
      const file = await runtime.agents.readWorkspaceFile(runtimeTarget.agentId, runtimeTarget.path)
      if (!file || file.metadata?.userEdited === true) continue
      await runtime.agents.removeWorkspaceFile(runtimeTarget.agentId, runtimeTarget.path)
      continue
    }
    if (runtimeTarget?.kind === 'agent-skill') {
      const skill = await runtime.skills.get(runtimeTarget.name, runtimeTarget.agentId)
      if (!skill || skill.metadata?.userEdited === true) continue
      await runtime.skills.remove(runtimeTarget.name, runtimeTarget.agentId)
      continue
    }
    if (runtimeTarget?.kind === 'global-skill') {
      const skill = await runtime.skills.get(runtimeTarget.name)
      if (!skill || skill.metadata?.userEdited === true) continue
      await runtime.skills.remove(runtimeTarget.name)
      continue
    }
    if (!existsSync(p.target)) continue
    if (isUserEdited(p.target)) continue
    if (statSync(p.target).isDirectory()) {
      rmSync(p.target, { recursive: true, force: true })
    } else {
      unlinkSync(p.target)
    }
    removeInstalledBy(p.target)
  }
}
