/**
 * Focused mutator for `bakin agents lessons {enable,disable,list}`.
 *
 * Under the composed-block model (layered-context spec) a lesson toggle is
 * just a lockfile `lessonsEnabled` change followed by a LOCAL sync — the
 * sync engine recomposes SOUL.md's managed block (catalog checkboxes +
 * enabled lesson bodies) from the installed source and writes the receipt.
 * No bespoke block surgery remains here.
 */
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { parseLessonFrontmatter } from '@bakin/core/format/frontmatter'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import {
  type AgentManifest,
  type Manifest,
  parseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  addPackage,
  readLockfile,
  writeLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { syncAgent } from './sync'

const log = createLogger('agent-pkg:lessons')

export interface LessonInfo {
  lessonId: string
  title: string
  tags: string[]
  defaultEnabled: boolean
  enabled: boolean
  /** Path the lesson body lives at in the installed package source dir. */
  sourcePath: string
}

/**
 * List every lesson the package contributes, with current enabled state
 * cross-referenced against the lockfile. Reads frontmatter for title +
 * tags + defaultEnabled.
 */
export function listLessons(packageId: string): LessonInfo[] {
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }

  const installDir = getPackageSourceDir(getContentDir(), entry.kind, packageId, entry.version)
  const manifest = readPackageManifest(installDir)
  if (!manifest || manifest.kind !== 'agent') return []

  const lessons = manifest.contributions.lessons ?? []
  const enabledSet = new Set(entry.lessonsEnabled ?? [])

  return lessons.map((rel) => parseLessonFile(join(installDir, rel), rel, enabledSet))
}

export interface ToggleResult {
  packageId: string
  lessonId: string
  enabled: boolean
  changed: boolean
}

/**
 * Enable or disable a single lesson. Idempotent — toggling an already-on
 * lesson on returns `changed: false` with no writes.
 */
export async function setLessonEnabled(
  packageId: string,
  lessonId: string,
  enabled: boolean,
): Promise<ToggleResult> {
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }
  if (entry.kind !== 'agent') {
    throw new Error(
      `Package "${packageId}" is a ${entry.kind} — lesson toggling only applies to agent packages.`,
    )
  }
  if (!entry.agentId) {
    throw new Error(`Lockfile entry for "${packageId}" is missing agentId — cannot resolve SOUL.md target.`)
  }

  const installDir = getPackageSourceDir(getContentDir(), entry.kind, packageId, entry.version)
  const manifest = readPackageManifest(installDir)
  if (!manifest || manifest.kind !== 'agent') {
    throw new Error(`Package source for "${packageId}" is missing or malformed.`)
  }

  const lessonPaths = (manifest.contributions.lessons ?? []).map((rel) => ({
    rel,
    abs: join(installDir, rel),
    lessonId: basename(rel).replace(/\.md$/i, ''),
  }))
  const target = lessonPaths.find((l) => l.lessonId === lessonId)
  if (!target) {
    throw new Error(
      `Lesson "${lessonId}" is not contributed by package "${packageId}". ` +
        `Available: ${lessonPaths.map((l) => l.lessonId).join(', ')}`,
    )
  }

  const currentEnabled = new Set(entry.lessonsEnabled ?? [])
  if (enabled) parseRequiredLessonFile(target.abs, target.rel, currentEnabled) // validates body exists
  const wasEnabled = currentEnabled.has(lessonId)
  if (wasEnabled === enabled) {
    return { packageId, lessonId, enabled, changed: false }
  }

  if (enabled) currentEnabled.add(lessonId)
  else currentEnabled.delete(lessonId)

  // Update the lockfile, then let the sync engine recompose SOUL.md's
  // managed block (local-only — no network fetch for a toggle).
  const nextEntry = { ...entry, lessonsEnabled: Array.from(currentEnabled).sort() }
  writeLockfile(addPackage(lock, packageId, nextEntry))
  await syncAgent(entry.agentId, { fetch: false, trigger: 'cli' })

  appendAudit(
    getContentDir(),
    enabled ? 'agent_pkg.lessons_enabled' : 'agent_pkg.lessons_disabled',
    entry.agentId,
    { packageId, lessonId },
    'cli',
  )

  log.info(`Lesson ${enabled ? 'enabled' : 'disabled'}`, {
    packageId,
    lessonId,
    agentId: entry.agentId,
  })

  return { packageId, lessonId, enabled, changed: true }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function readPackageManifest(installDir: string): Manifest | null {
  const path = join(installDir, 'bakin-package.json')
  if (!existsSync(path)) return null
  try {
    return parseManifest(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return null
  }
}

interface ParsedLesson {
  lessonId: string
  title: string
  tags: string[]
  defaultEnabled: boolean
  body: string
  sourcePath: string
}

function parseLessonFile(
  absPath: string,
  packageRel: string,
  enabled: Set<string>,
): ParsedLesson & { enabled: boolean } {
  const lessonId = basename(packageRel).replace(/\.md$/i, '')
  let title = lessonId
  let tags: string[] = []
  let defaultEnabled = false
  let body = ''

  if (existsSync(absPath)) {
    const parsed = parseLessonFrontmatter(readFileSync(absPath, 'utf-8'))
    title = parsed.title || lessonId
    tags = parsed.tags
    defaultEnabled = parsed.defaultEnabled
    body = parsed.body
  }

  return {
    lessonId,
    title,
    tags,
    defaultEnabled,
    body,
    sourcePath: absPath,
    enabled: enabled.has(lessonId),
  }
}

function parseRequiredLessonFile(
  absPath: string,
  packageRel: string,
  enabled: Set<string>,
): ParsedLesson & { enabled: boolean } {
  if (!existsSync(absPath)) {
    throw new Error(`Lesson source file is missing: ${packageRel}`)
  }
  const lesson = parseLessonFile(absPath, packageRel, enabled)
  if (!lesson.body.trim()) {
    throw new Error(`Lesson source file is empty: ${packageRel}`)
  }
  return lesson
}


// Reference type imports so unused-import linting doesn't trip
void ((null as unknown) as AgentManifest)
void ((null as unknown) as LessonInfo)
