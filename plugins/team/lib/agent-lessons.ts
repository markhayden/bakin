/**
 * Agent-package lesson file helpers for the team plugin.
 *
 * Extracted from index.ts. Pure path parsing + filesystem reads over the
 * installed agent-package lessons tree (`~/.bakin/packages/agents/<id>@<ver>/
 * lessons/*.md`) — used by team's lesson search-index content type (the
 * `bakin_agent-lessons` table) and its reindex generator. No plugin-context
 * dependency.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

import { parseLessonFrontmatter as parseLessonFm } from '@bakin/core/format/frontmatter'

import { getContentDir } from '../../../packages/core/src/content-dir'

interface LessonFileParts {
  packageId: string
  version: string
  lessonId: string
  agentId: string
}

export function parseLessonFilePath(rel: string): LessonFileParts | null {
  // rel example: 'packages/agents/pixel@0.1.0/lessons/style.md'
  const segments = rel.split('/')
  if (segments.length < 5) return null
  if (segments[0] !== 'packages' || segments[1] !== 'agents') return null
  if (segments[3] !== 'lessons') return null
  const dirName = segments[2]
  const lessonFile = segments[4]
  if (!lessonFile.endsWith('.md')) return null
  const at = dirName.lastIndexOf('@')
  if (at === -1) return null
  const packageId = dirName.slice(0, at)
  const version = dirName.slice(at + 1)
  const lessonId = lessonFile.replace(/\.md$/i, '')
  // For kind:"agent" packages the package id IS the agent id; this matches
  // the projection convention in src/core/agent-packages/projector.ts.
  return { packageId, version, agentId: packageId, lessonId }
}

export function agentLessonFileToId(rel: string): string {
  const parts = parseLessonFilePath(rel)
  if (!parts) return rel.replace(/[^a-zA-Z0-9_]+/g, '_')
  return `${parts.packageId}@${parts.version}/${parts.lessonId}`
}

export function agentLessonKeyToFilePath(key: string): string | null {
  const slash = key.indexOf('/')
  if (slash === -1) return null
  const dirPart = key.slice(0, slash)
  const lesson = key.slice(slash + 1)
  return join(getContentDir(), 'packages', 'agents', dirPart, 'lessons', `${lesson}.md`)
}

export interface LessonDoc extends Record<string, unknown> {
  title: string
  body: string
  package_id: string
  agent_id: string
  lesson_id: string
  tags: string[]
  default_enabled: 'true' | 'false'
  updated_at: string
}

export function parseLessonFrontmatter(raw: string): {
  title: string
  body: string
  tags: string[]
  defaultEnabled: boolean
} {
  const { title, body, tags, defaultEnabled } = parseLessonFm(raw)
  return { title: title ?? '', body, tags, defaultEnabled }
}

export async function agentLessonFileToDoc(rel: string): Promise<LessonDoc | null> {
  const parts = parseLessonFilePath(rel)
  if (!parts) return null
  const abs = join(getContentDir(), rel)
  if (!existsSync(abs)) return null
  let raw: string
  try {
    raw = readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
  const { title, body, tags, defaultEnabled } = parseLessonFrontmatter(raw)
  return {
    title: title || parts.lessonId,
    body,
    package_id: parts.packageId,
    agent_id: parts.agentId,
    lesson_id: parts.lessonId,
    tags,
    default_enabled: defaultEnabled ? 'true' : 'false',
    updated_at: new Date().toISOString(),
  }
}

/**
 * Walk every installed agent package's lessons/ dir and yield
 * (key, doc) pairs for the search index reindexer.
 */
export function* agentLessonReindexAll(): Generator<{ key: string; doc: LessonDoc }> {
  const root = join(getContentDir(), 'packages', 'agents')
  if (!existsSync(root)) return
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const lessonsDir = join(root, dirent.name, 'lessons')
    if (!existsSync(lessonsDir)) continue
    let stat
    try { stat = statSync(lessonsDir) } catch { continue }
    if (!stat.isDirectory()) continue
    for (const file of readdirSync(lessonsDir)) {
      if (!file.endsWith('.md')) continue
      const rel = relative(getContentDir(), join(lessonsDir, file))
      const parts = parseLessonFilePath(rel)
      if (!parts) continue
      const raw = readFileSync(join(lessonsDir, file), 'utf-8')
      const { title, body, tags, defaultEnabled } = parseLessonFrontmatter(raw)
      const key = `${parts.packageId}@${parts.version}/${parts.lessonId}`
      yield {
        key,
        doc: {
          title: title || parts.lessonId,
          body,
          package_id: parts.packageId,
          agent_id: parts.agentId,
          lesson_id: parts.lessonId,
          tags,
          default_enabled: defaultEnabled ? 'true' : 'false',
          updated_at: new Date().toISOString(),
        },
      }
    }
  }
}
