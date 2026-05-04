import { existsSync, readFileSync, statSync } from 'fs'
import { basename, isAbsolute, normalize, relative, resolve } from 'path'
import type { Manifest } from '../../../packages/core/src/agent-packages/manifest'

const LESSON_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,39}$/i
const LESSON_PATH_PATTERN = /^lessons\/[^/]+\.md$/i

export interface LessonIntegrityOptions {
  manifest: Manifest
  stagingDir: string
  /**
   * Explicit enabled lesson ids. Update passes lockfile state here so a
   * package update cannot silently orphan an enabled lesson.
   */
  enabledLessons?: string[]
}

export function validatePackageLessonIntegrity(options: LessonIntegrityOptions): void {
  const rels = contributedLessonRels(options.manifest)
  const ids = new Map<string, string>()

  for (const rel of rels) {
    const normalizedRel = normalizePackageRel(rel)
    validateLessonRel(options.manifest.id, rel, normalizedRel)

    const abs = resolve(options.stagingDir, normalizedRel)
    if (!isPathInside(options.stagingDir, abs)) {
      throw new Error(`Lesson source path escapes the package root: ${rel}`)
    }
    if (!existsSync(abs)) {
      throw new Error(`Lesson source file is missing: ${rel}`)
    }
    if (!statSync(abs).isFile()) {
      throw new Error(`Lesson source path is not a file: ${rel}`)
    }

    const lessonId = lessonIdFromRel(normalizedRel)
    const existingRel = ids.get(lessonId)
    if (existingRel) {
      throw new Error(
        `Duplicate lesson id "${lessonId}" in package "${options.manifest.id}": ` +
          `${existingRel} and ${rel}`,
      )
    }
    ids.set(lessonId, normalizedRel)

    const body = extractLessonBody(readFileSync(abs, 'utf-8'))
    if (!body.trim()) {
      throw new Error(`Lesson source file is empty: ${rel}`)
    }
  }

  if (options.manifest.kind !== 'agent') return

  const enabledLessons = options.enabledLessons ?? options.manifest.install.enableLessons ?? []
  const seenEnabled = new Set<string>()
  for (const lessonId of enabledLessons) {
    if (seenEnabled.has(lessonId)) {
      throw new Error(`Enabled lesson "${lessonId}" is listed more than once in package "${options.manifest.id}".`)
    }
    seenEnabled.add(lessonId)
    if (!ids.has(lessonId)) {
      const available = Array.from(ids.keys()).sort().join(', ') || '<none>'
      throw new Error(
        `Enabled lesson "${lessonId}" is not contributed by package "${options.manifest.id}". ` +
          `Available: ${available}`,
      )
    }
  }
}

function contributedLessonRels(manifest: Manifest): string[] {
  if (manifest.kind === 'agent') return manifest.contributions.lessons ?? []
  if (manifest.kind === 'lesson-pack') return manifest.contributions.lessons
  return []
}

function normalizePackageRel(rel: string): string {
  return normalize(rel).replaceAll('\\', '/')
}

function validateLessonRel(packageId: string, originalRel: string, normalizedRel: string): void {
  if (isAbsolute(originalRel) || normalizedRel === '..' || normalizedRel.startsWith('../')) {
    throw new Error(`Lesson source path escapes the package root: ${originalRel}`)
  }
  if (!LESSON_PATH_PATTERN.test(normalizedRel)) {
    throw new Error(
      `Lesson contribution "${originalRel}" in package "${packageId}" must use lessons/<lesson-id>.md ` +
        `so search indexing and dispatch retrieval can find it.`,
    )
  }

  const lessonId = lessonIdFromRel(normalizedRel)
  if (!LESSON_ID_PATTERN.test(lessonId)) {
    throw new Error(
      `Lesson id "${lessonId}" from ${originalRel} must match /^[a-z0-9][a-z0-9-_]{0,39}$/i.`,
    )
  }
}

function lessonIdFromRel(rel: string): string {
  return basename(rel).replace(/\.md$/i, '')
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function extractLessonBody(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
  return match ? match[1].trim() : normalized.trim()
}
