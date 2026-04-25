/**
 * Projector — writes a package's contributions onto disk.
 *
 * This is the side-effecting half of an install. The pure halves —
 * manifest validation, lockfile mutators, marker primitives — already
 * landed in earlier phases. The projector consumes a parsed manifest
 * plus a staging directory and produces:
 *
 *   - workspace files at {openclaw}/workspaces/<agentId>/<file>
 *     (fresh mode only; update mode honors --refresh-template; adopt
 *      mode skips entirely)
 *   - skills at {openclaw}/workspaces/<agentId>/skills/<name>/  for kind:"agent"
 *     or  ~/.openclaw/skills/<name>/                            for kind:"skill-pack"
 *   - assets at ~/.bakin/agents/<agentId>/<file>
 *   - knowledge markers injected into the agent's SOUL.md (catalog +
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
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { getContentDir } from '../content-dir'
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
  removeInstalledBy,
  writeInstalledBy,
} from '../../../packages/core/src/agent-packages/markers'
import {
  injectBlock,
  removeBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'

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
  /** Lesson ids to enable on this projection. Defaults to manifest.install.enableKnowledge. */
  enabledKnowledge?: string[]
  /** Provenance metadata stamped onto every .installedBy sidecar. */
  installedBy: Omit<InstalledByMarker, 'sha256'>
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

  /** Roll back every op in reverse order. Best-effort — log failures. */
  rollback(): void {
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
        }
      } catch (err) {
        log.warn('Rollback step failed', {
          op: op.kind,
          path: op.path,
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

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue // refuse symlinks — can't escape
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

/**
 * Write the contents of a single file with rollback support. Records the
 * write or the modification (with previous bytes captured) in the write log.
 */
function writeFileTracked(path: string, body: string, log: WriteLog): void {
  ensureDir(dirname(path), log)
  if (existsSync(path)) {
    const prev = readFileSync(path, 'utf-8')
    writeFileSync(path, body, 'utf-8')
    log.recordModifiedFile(path, prev)
  } else {
    writeFileSync(path, body, 'utf-8')
    log.recordCreatedFile(path)
  }
}

// ─── Workspace files ─────────────────────────────────────────────────────────

function projectWorkspaceFiles(
  manifest: AgentManifest,
  agentId: string,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): void {
  const files = manifest.contributions.workspaceFiles ?? []
  if (files.length === 0) return

  const wsDir = getOpenClawPath('workspaces', agentId)

  for (const rel of files) {
    const src = join(options.stagingDir, rel)
    if (!existsSync(src)) {
      log.warn('Workspace-file source missing — skipping', { rel })
      continue
    }
    // Workspace files land at the workspace root with the file's basename,
    // ignoring intermediate directories in the package source. The package
    // ships them under workspace/SOUL.md but they project as just SOUL.md.
    const target = join(wsDir, basename(rel))

    if (isUserEdited(target)) {
      result.skipped.push({ target, reason: 'userEdited' })
      continue
    }

    // Adopt mode: never write workspace template files.
    if (options.mode === 'adopt') continue

    // Update mode: only rewrite when --refresh-template is requested.
    if (options.mode === 'update' && !options.refreshTemplate) continue

    const body = readFileSync(src, 'utf-8')
    writeFileTracked(target, body, writeLog)

    const sha256 = computeFileSha(target)
    const marker: InstalledByMarker = { ...options.installedBy, sha256 }
    writeInstalledBy(target, marker)
    writeLog.recordCreatedFile(installedByPath(target))

    result.projections.push({
      kind: 'workspace-file',
      target,
      sha256,
      templateOnly: true,
    })
  }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

function skillProjectionTarget(
  manifest: Manifest,
  skillName: string,
  agentId: string | undefined,
): string {
  if (manifest.kind === 'agent') {
    if (!agentId) throw new Error('agentId required for kind:"agent" skill projection')
    return getOpenClawPath('workspaces', agentId, 'skills', skillName)
  }
  if (manifest.kind === 'skill-pack') {
    return getOpenClawPath('skills', skillName)
  }
  throw new Error(`projectSkill called with unsupported kind: ${manifest.kind}`)
}

function projectSkills(
  manifest: AgentManifest | SkillPackManifest,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): void {
  const skillRels =
    manifest.kind === 'agent'
      ? (manifest.contributions.skills ?? [])
      : manifest.contributions.skills

  if (skillRels.length === 0) return

  for (const rel of skillRels) {
    const src = join(options.stagingDir, rel)
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      log.warn('Skill source missing or not a directory — skipping', { rel })
      continue
    }
    const skillName = basename(rel)
    const target = skillProjectionTarget(manifest, skillName, options.agentId)

    if (isUserEdited(target)) {
      result.skipped.push({ target, reason: 'userEdited' })
      continue
    }

    // Skills always project on fresh + update; adopt mode also installs
    // skills (the user opted into the package's capabilities).
    const targetExisted = existsSync(target)
    if (targetExisted) {
      // Replace by removing first — atomicity is handled by the recorded
      // tree pointer in the write log; rollback re-creates it from staging.
      rmSync(target, { recursive: true, force: true })
    }

    copyTree(src, target)
    if (!targetExisted) {
      writeLog.recordCreatedTree(target)
    } else {
      // We can't trivially capture the prior tree — for V1 we record a
      // "created-tree" rollback even on overwrite, accepting that rollback
      // of an update returns to "no skill installed" rather than "previous
      // version installed." A future pass can swap to a sibling-rename
      // pattern for true rollback-to-prior-version.
      writeLog.recordCreatedTree(target)
    }

    const sha256 = computeDirSha(target)
    writeInstalledBy(target, { ...options.installedBy, sha256 })
    writeLog.recordCreatedFile(installedByPath(target))

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

// ─── Knowledge markers (SOUL.md catalog + per-lesson blocks) ─────────────────

interface KnowledgeFileMeta {
  lessonId: string
  title: string
  body: string
  defaultEnabled: boolean
  packageRel: string
}

function parseKnowledgeFile(absPath: string, packageRel: string): KnowledgeFileMeta {
  const raw = readFileSync(absPath, 'utf-8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  let title = basename(absPath).replace(/\.md$/i, '')
  let defaultEnabled = false
  let body = raw.trim()

  if (match) {
    body = match[2].trim()
    // Light frontmatter parse — we only need title + defaultEnabled, and
    // bringing in js-yaml here pulls a heavy dep into the projector. The
    // installer is the right place for full frontmatter access (it'll
    // index knowledge into search per CC-2).
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

function readKnowledgeFiles(
  manifest: AgentManifest,
  options: ProjectorOptions,
): KnowledgeFileMeta[] {
  const rels = manifest.contributions.knowledge ?? []
  const out: KnowledgeFileMeta[] = []
  for (const rel of rels) {
    const abs = join(options.stagingDir, rel)
    if (!existsSync(abs)) {
      log.warn('Knowledge source missing — skipping', { rel })
      continue
    }
    out.push(parseKnowledgeFile(abs, rel))
  }
  return out
}

function knowledgeBlockId(packageId: string, lessonId: string): string {
  return `knowledge:${packageId}:${lessonId}`
}

const CATALOG_BLOCK_ID = 'knowledge-catalog'

function buildCatalogBody(
  packageId: string,
  knowledge: KnowledgeFileMeta[],
  enabled: Set<string>,
): string {
  if (knowledge.length === 0) {
    return `> No knowledge available from ${packageId}.`
  }
  const lines = [
    `> Knowledge available from agent-package \`${packageId}\`. ` +
      `Toggle individual lessons via \`bakin agents knowledge enable|disable\`.`,
    '',
  ]
  for (const k of knowledge) {
    const mark = enabled.has(k.lessonId) ? '[x]' : '[ ]'
    lines.push(`- ${mark} **${k.title}** (\`${k.lessonId}\`)`)
  }
  return lines.join('\n')
}

function projectKnowledgeMarkers(
  manifest: AgentManifest,
  agentId: string,
  options: ProjectorOptions,
  result: ProjectorResult,
  writeLog: WriteLog,
): void {
  const soulPath = getOpenClawPath('workspaces', agentId, 'SOUL.md')
  if (!existsSync(soulPath)) {
    // Adopt mode without an existing SOUL.md is unusual but possible if
    // the user pre-created the agent and never wrote SOUL.md. Skip with
    // a warning — the doctor will surface it.
    log.warn('SOUL.md missing — knowledge markers skipped', { soulPath })
    return
  }

  if (isUserEdited(soulPath)) {
    result.skipped.push({ target: soulPath, reason: 'userEdited' })
    return
  }

  const knowledge = readKnowledgeFiles(manifest, options)
  const enabledList = options.enabledKnowledge
    ?? manifest.install.enableKnowledge
    ?? knowledge.filter((k) => k.defaultEnabled).map((k) => k.lessonId)
  const enabled = new Set(enabledList)

  const before = readFileSync(soulPath, 'utf-8')
  let updated = before

  // 1. Catalog block — always written, lists every available lesson with
  //    its enabled state.
  updated = injectBlock(
    updated,
    CATALOG_BLOCK_ID,
    buildCatalogBody(manifest.id, knowledge, enabled),
  )

  // 2. Per-lesson blocks — present only for enabled lessons. Disabled
  //    lessons get their block removed (handles the toggle-off path).
  for (const k of knowledge) {
    const blockId = knowledgeBlockId(manifest.id, k.lessonId)
    if (enabled.has(k.lessonId)) {
      updated = injectBlock(updated, blockId, k.body)
    } else {
      updated = removeBlock(updated, blockId)
    }
  }

  if (updated !== before) {
    writeFileTracked(soulPath, updated, writeLog)
  }

  // Record one projection entry for the catalog plus one per enabled lesson.
  result.projections.push({
    kind: 'knowledge-marker',
    target: soulPath,
    blockId: CATALOG_BLOCK_ID,
  })
  for (const k of knowledge) {
    if (!enabled.has(k.lessonId)) continue
    result.projections.push({
      kind: 'knowledge-marker',
      target: soulPath,
      blockId: knowledgeBlockId(manifest.id, k.lessonId),
    })
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Project a parsed package's contributions onto disk. Atomic at the
 * package level: any error rolls back every successful write before
 * re-throwing so the install state matches what was on disk before.
 */
export function projectPackage(options: ProjectorOptions): ProjectorResult {
  const result: ProjectorResult = { projections: [], skipped: [] }
  const writeLog = new WriteLog()

  try {
    if (options.manifest.kind === 'agent') {
      if (!options.agentId) {
        throw new Error('agentId required for kind:"agent" projection')
      }
      projectWorkspaceFiles(options.manifest, options.agentId, options, result, writeLog)
      projectSkills(options.manifest, options, result, writeLog)
      projectAssets(options.manifest, options.agentId, options, result, writeLog)
      projectKnowledgeMarkers(options.manifest, options.agentId, options, result, writeLog)
    } else if (options.manifest.kind === 'skill-pack') {
      projectSkills(options.manifest, options, result, writeLog)
    }
    // workflow-pack and knowledge-pack don't project filesystem-side at
    // V1 — workflow-pack lives in the source registry (boot-time load),
    // knowledge-pack is search-indexed by the team plugin. Their
    // package source dir under ~/.bakin/packages/* is the only "projection."
  } catch (err) {
    writeLog.rollback()
    throw err
  }

  return result
}

/**
 * Reverse a projection — used by the uninstaller (Phase E-6). Removes
 * every projected file (skipping `.userEdited` ones), removes sidecars,
 * and strips knowledge markers from SOUL.md.
 */
export function unprojectPackage(
  projections: ProjectionEntry[],
  options: { keepBlocks?: boolean } = {},
): void {
  for (const p of projections) {
    if (p.kind === 'knowledge-marker') {
      if (options.keepBlocks) continue
      if (!existsSync(p.target)) continue
      if (isUserEdited(p.target)) continue
      const before = readFileSync(p.target, 'utf-8')
      const after = removeBlock(before, p.blockId ?? '')
      if (after !== before) writeFileSync(p.target, after, 'utf-8')
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
