/**
 * Brand-lesson retrieval for the dispatch card (#419, spec §6).
 *
 * Mirrors the agent-lessons retrieval plane: top-N lessons relevant to the
 * task's title/description, faceted to the brand, hydrated from disk (search
 * hits may be chunks). Own cache keyed (brandId, query) — NEVER the
 * agent-lesson cache (cross-brand bleed guard). Engine-down is an honest
 * `unavailable` result the card renders as a visible marker; it never blocks
 * dispatch.
 */
import { crossTableSearch } from '../../../src/core/search-registry'
import { splitFrontmatter } from '@bakin/core/format/frontmatter'
import { readDoc } from './store'

export interface RetrievedBrandLesson {
  name: string
  body: string
}

export type BrandLessonResult =
  | { status: 'ok'; lessons: RetrievedBrandLesson[] }
  | { status: 'unavailable' }

const MAX_LESSONS = 3
const MAX_LESSON_CHARS = 1500
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200
const cache = new Map<string, { result: BrandLessonResult; expires: number }>()

/** @internal Test-only. */
export function __resetBrandLessonCache(): void {
  cache.clear()
}

type SearchFn = typeof crossTableSearch

export async function retrieveBrandLessons(
  brandId: string,
  query: string,
  search: SearchFn = crossTableSearch,
): Promise<BrandLessonResult> {
  const q = query.trim()
  if (!q) return { status: 'ok', lessons: [] }

  const key = `${brandId}\0${q}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.result

  let result: BrandLessonResult
  try {
    const response = await search(q, {
      table: 'brand-lessons',
      limit: MAX_LESSONS * 4,
      filters: { brand_id: brandId },
    })
    if (response.meta.source === 'unavailable') {
      result = { status: 'unavailable' }
    } else {
      const lessons: RetrievedBrandLesson[] = []
      const seen = new Set<string>()
      for (const hit of [...response.results].sort((a, b) => b.score - a.score)) {
        if (lessons.length >= MAX_LESSONS) break
        const fields = hit.fields as { brand_id?: unknown; lesson_id?: unknown }
        const hitBrand = typeof fields.brand_id === 'string' ? fields.brand_id : ''
        const lessonId = typeof fields.lesson_id === 'string' ? fields.lesson_id : ''
        if (hitBrand !== brandId || !lessonId || seen.has(lessonId)) continue
        seen.add(lessonId)
        // Hydrate the WHOLE lesson from disk — search hits may be chunks.
        const raw = readDoc(brandId, 'lessons', `${lessonId}.md`)
        if (raw === null) continue
        const body = splitFrontmatter(raw).body.slice(0, MAX_LESSON_CHARS)
        if (!body) continue
        lessons.push({ name: `${lessonId}.md`, body })
      }
      result = { status: 'ok', lessons }
    }
  } catch {
    result = { status: 'unavailable' }
  }

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  // Unavailable results get a short TTL so recovery is picked up quickly.
  cache.set(key, { result, expires: Date.now() + (result.status === 'unavailable' ? 30_000 : CACHE_TTL_MS) })
  return result
}
