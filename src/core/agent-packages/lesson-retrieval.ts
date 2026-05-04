import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { SearchResponse } from '../../../packages/core/src/plugin-types'
import {
  findAgentPackage,
  readLockfile,
  type PackageEntry,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { crossTableSearch } from '../search-registry'

export interface AgentPackageLessonRetrievalSettings {
  enabled: boolean
  injectIntoDispatch: boolean
  mcpTool: boolean
  maxLessons: number
  maxCharacters: number
  minScore: number
}

export const DEFAULT_LESSON_RETRIEVAL_SETTINGS: AgentPackageLessonRetrievalSettings = {
  enabled: true,
  injectIntoDispatch: true,
  mcpTool: true,
  maxLessons: 3,
  maxCharacters: 8000,
  minScore: 0,
}

export interface RetrievedLesson {
  packageId: string
  agentId: string
  lessonId: string
  title: string
  body: string
  tags: string[]
  score: number
}

export interface LessonRetrievalResult {
  lessons: RetrievedLesson[]
  packageId?: string
  reason?: 'disabled' | 'dispatch-disabled' | 'no-package' | 'no-enabled-lessons' | 'no-query' | 'search-unavailable'
}

export type LessonSearchFn = (
  q: string,
  opts: {
    table?: string
    limit?: number
    filters?: Record<string, string | boolean | number>
  },
) => Promise<SearchResponse>

export function normalizeLessonRetrievalSettings(
  input?: Partial<AgentPackageLessonRetrievalSettings>,
): AgentPackageLessonRetrievalSettings {
  const merged = { ...DEFAULT_LESSON_RETRIEVAL_SETTINGS, ...(input ?? {}) }
  return {
    enabled: merged.enabled !== false,
    injectIntoDispatch: merged.injectIntoDispatch !== false,
    mcpTool: merged.mcpTool !== false,
    maxLessons: clampInteger(merged.maxLessons, 1, 10, DEFAULT_LESSON_RETRIEVAL_SETTINGS.maxLessons),
    maxCharacters: clampInteger(merged.maxCharacters, 1000, 50000, DEFAULT_LESSON_RETRIEVAL_SETTINGS.maxCharacters),
    minScore: typeof merged.minScore === 'number' && Number.isFinite(merged.minScore)
      ? Math.max(0, merged.minScore)
      : DEFAULT_LESSON_RETRIEVAL_SETTINGS.minScore,
  }
}

export async function retrieveAgentPackageLessons(options: {
  contentDir: string
  agentId: string
  query: string
  settings?: Partial<AgentPackageLessonRetrievalSettings>
  requireDispatchInjection?: boolean
  search?: LessonSearchFn
}): Promise<LessonRetrievalResult> {
  const settings = normalizeLessonRetrievalSettings(options.settings)
  if (!settings.enabled) return { lessons: [], reason: 'disabled' }
  if (options.requireDispatchInjection && !settings.injectIntoDispatch) {
    return { lessons: [], reason: 'dispatch-disabled' }
  }

  const query = options.query.trim()
  if (!query) return { lessons: [], reason: 'no-query' }

  const lock = readLockfile(join(options.contentDir, 'packages', 'lock.json'))
  const owner = findAgentPackage(lock, options.agentId)
  if (!owner) return { lessons: [], reason: 'no-package' }

  const enabledLessonIds = new Set(owner.entry.lessonsEnabled ?? [])
  if (enabledLessonIds.size === 0) {
    return { lessons: [], packageId: owner.id, reason: 'no-enabled-lessons' }
  }

  const search = options.search ?? crossTableSearch
  const candidateLimit = Math.max(settings.maxLessons * 6, 12)
  const response = await search(query, {
    table: 'agent-lessons',
    limit: candidateLimit,
    filters: { package_id: owner.id },
  })

  if (response.meta.source === 'fallback') {
    return { lessons: [], packageId: owner.id, reason: 'search-unavailable' }
  }

  const sorted = [...response.results].sort((a, b) => b.score - a.score)
  const lessons: RetrievedLesson[] = []
  const seen = new Set<string>()
  for (const hit of sorted) {
    if (lessons.length >= settings.maxLessons) break
    if (hit.score < settings.minScore) continue

    const fields = hit.fields
    const packageId = stringField(fields.package_id)
    const lessonId = stringField(fields.lesson_id)
    if (packageId !== owner.id) continue
    if (!lessonId || !enabledLessonIds.has(lessonId)) continue
    if (seen.has(lessonId)) continue

    const diskLesson = readLessonFromDisk(options.contentDir, owner.id, owner.entry, lessonId)
    if (!diskLesson?.body.trim()) continue

    lessons.push({
      packageId,
      agentId: options.agentId,
      lessonId,
      title: diskLesson.title || lessonId,
      body: diskLesson.body,
      tags: diskLesson.tags,
      score: hit.score,
    })
    seen.add(lessonId)
  }

  return { lessons, packageId: owner.id }
}

export function formatLessonsForDispatch(
  lessons: RetrievedLesson[],
  maxCharacters?: number,
): string {
  if (lessons.length === 0) return ''
  const budget = clampInteger(
    maxCharacters,
    1000,
    50000,
    DEFAULT_LESSON_RETRIEVAL_SETTINGS.maxCharacters,
  )

  const lines = [
    '## Relevant Package Lessons',
    '',
    'Bakin selected these enabled agent-package lessons for this assignment. Use them as context; the task instructions still take priority.',
    '',
  ]
  let used = lines.join('\n').length

  for (const lesson of lessons) {
    const header = [
      `### ${lesson.title}`,
      `- Package: ${lesson.packageId}`,
      `- Lesson: ${lesson.lessonId}`,
      `- Relevance: ${formatScore(lesson.score)}`,
      ...(lesson.tags.length > 0 ? [`- Tags: ${lesson.tags.join(', ')}`] : []),
      '',
    ].join('\n')

    const remaining = budget - used - header.length - 2
    if (remaining <= 120) break
    const body = truncateText(lesson.body, remaining)
    lines.push(header)
    lines.push(body)
    lines.push('')
    used += header.length + body.length + 2
  }

  return lines.join('\n').trimEnd()
}

export function buildTaskLessonQuery(input: {
  title: string
  description?: string
  instructions?: string
  context?: string
}): string {
  return [
    input.title,
    input.description,
    input.instructions,
    input.context,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n\n')
}

function readLessonFromDisk(
  contentDir: string,
  packageId: string,
  entry: PackageEntry,
  lessonId: string,
): { title: string; body: string; tags: string[] } | null {
  const lessonPath = join(
    getPackageSourceDir(contentDir, entry.kind, packageId, entry.version),
    'lessons',
    `${lessonId}.md`,
  )
  if (!existsSync(lessonPath)) return null

  try {
    return parseLessonMarkdown(readFileSync(lessonPath, 'utf-8'), lessonId)
  } catch {
    return null
  }
}

function parseLessonMarkdown(raw: string, fallbackTitle: string): { title: string; body: string; tags: string[] } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { title: fallbackTitle, body: raw.trim(), tags: [] }

  let title = fallbackTitle
  let tags: string[] = []
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('title:')) {
      title = trimmed.slice('title:'.length).trim().replace(/^['"]|['"]$/g, '') || fallbackTitle
    } else if (trimmed.startsWith('tags:')) {
      const rest = trimmed.slice('tags:'.length).trim()
      if (rest.startsWith('[') && rest.endsWith(']')) {
        tags = rest
          .slice(1, -1)
          .split(',')
          .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      }
    }
  }
  return { title, body: match[2].trim(), tags }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value
  return `${value.slice(0, Math.max(0, maxCharacters - 16)).trimEnd()}... [truncated]`
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '0.00'
  return score.toFixed(2)
}
