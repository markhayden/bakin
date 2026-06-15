/**
 * Lesson-file reading shared by the projector, sync scanner, and lesson
 * toggling (extracted from the projector in C4 of the layered-context spec).
 *
 * A lesson is a markdown file with optional frontmatter (title /
 * defaultEnabled). Light hand-rolled frontmatter parse — full YAML isn't
 * needed for two scalar fields and js-yaml is a heavy dep at this layer.
 */
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import type { AgentManifest } from '../../../packages/core/src/agent-packages/manifest'
import type { LessonEntry } from '../../../packages/core/src/agent-packages/composer'
import { parseLessonFrontmatter } from '@bakin/core/format/frontmatter'
import { createLogger } from '../logger'

const log = createLogger('agent-pkg:lessons')

export interface LessonFileMeta {
  lessonId: string
  title: string
  body: string
  defaultEnabled: boolean
  packageRel: string
}

export function parseLessonFile(absPath: string, packageRel: string): LessonFileMeta {
  const raw = readFileSync(absPath, 'utf-8')
  const lessonId = basename(absPath).replace(/\.md$/i, '')
  const { title, defaultEnabled, body } = parseLessonFrontmatter(raw)
  return { lessonId, title: title || lessonId, body, defaultEnabled, packageRel }
}

/** Read every lesson the manifest declares from the package source dir. */
export function readPackageLessons(manifest: AgentManifest, sourceDir: string): LessonFileMeta[] {
  const rels = manifest.contributions.lessons ?? []
  const out: LessonFileMeta[] = []
  for (const rel of rels) {
    const abs = join(sourceDir, rel)
    if (!existsSync(abs)) {
      log.warn('Lesson source missing — skipping', { rel, sourceDir })
      continue
    }
    out.push(parseLessonFile(abs, rel))
  }
  return out
}

/**
 * Resolve which lessons are enabled: explicit list (lockfile) → manifest
 * install default → per-lesson defaultEnabled flags.
 */
export function resolveEnabledLessons(
  manifest: AgentManifest,
  lessons: LessonFileMeta[],
  explicit?: string[],
): Set<string> {
  return new Set(
    explicit
      ?? manifest.install.enableLessons
      ?? lessons.filter((l) => l.defaultEnabled).map((l) => l.lessonId),
  )
}

/** Shape lessons for the composer's `lessons` input. */
export function lessonComposerEntries(
  lessons: LessonFileMeta[],
  enabled: Set<string>,
): LessonEntry[] {
  return lessons.map((l) => ({
    id: l.lessonId,
    title: l.title,
    enabled: enabled.has(l.lessonId),
    body: enabled.has(l.lessonId) ? l.body : undefined,
  }))
}
