/**
 * Brand-lesson retrieval (#419, spec §6): faceted top-N, whole-lesson
 * hydration from disk, (brandId, query)-keyed cache isolation, honest
 * engine-down result.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-lessons-${Date.now()}-${randomUUID()}`)
const paths = () => ({
  home: testDir,
  brands: join(testDir, 'brands'),
  db: join(testDir, 'bakin.db'),
})

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
// Retrieval takes an injectable search fn — the registry itself stays out.
mock.module('../../../src/core/search-registry', () => ({
  crossTableSearch: mock().mockResolvedValue({ results: [], meta: { source: 'unavailable' } }),
}))

import { retrieveBrandLessons, __resetBrandLessonCache } from '../../../plugins/brands/lib/lesson-retrieval'
import { createBrand, writeDoc } from '../../../plugins/brands/lib/store'

beforeEach(() => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
  __resetBrandLessonCache()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const hit = (brandId: string, lessonId: string, score: number) => ({
  id: `${brandId}/${lessonId}`,
  score,
  fields: { brand_id: brandId, lesson_id: lessonId },
})

describe('retrieveBrandLessons', () => {
  it('hydrates whole lessons from disk, top-N by score, brand-scoped', async () => {
    createBrand({ id: 'acme', name: 'Acme' })
    writeDoc('acme', 'lessons', 'tweet-flops.md', '---\ntitle: Tweet flops\n---\n\nNo threads on Friday.')
    writeDoc('acme', 'lessons', 'logo-misuse.md', 'Never stretch the logo.')

    const search = mock().mockResolvedValue({
      results: [
        hit('acme', 'logo-misuse', 0.4),
        hit('acme', 'tweet-flops', 0.9),
        hit('other', 'leaky', 0.99), // wrong brand — filtered even if the facet leaked
        hit('acme', 'ghost', 0.8), // no file on disk — skipped
      ],
      meta: { source: 'antfly' },
    }) as never

    const result = await retrieveBrandLessons('acme', 'write launch tweet', search)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.lessons.map((l) => l.name)).toEqual(['tweet-flops.md', 'logo-misuse.md'])
      expect(result.lessons[0].body).toContain('No threads on Friday.')
      expect(result.lessons[0].body).not.toContain('---') // frontmatter stripped
    }
  })

  it('caches per (brandId, query) — two brands never share entries', async () => {
    createBrand({ id: 'acme', name: 'Acme' })
    createBrand({ id: 'loaf', name: 'Loaf' })
    writeDoc('acme', 'lessons', 'a.md', 'Acme lesson.')
    writeDoc('loaf', 'lessons', 'b.md', 'Loaf lesson.')

    const search = mock()
      .mockResolvedValueOnce({ results: [hit('acme', 'a', 1)], meta: { source: 'antfly' } })
      .mockResolvedValueOnce({ results: [hit('loaf', 'b', 1)], meta: { source: 'antfly' } }) as never

    const first = await retrieveBrandLessons('acme', 'same query', search)
    const second = await retrieveBrandLessons('loaf', 'same query', search)
    const cachedFirst = await retrieveBrandLessons('acme', 'same query', search)

    if (first.status !== 'ok' || second.status !== 'ok' || cachedFirst.status !== 'ok') throw new Error('expected ok')
    expect(first.lessons[0].name).toBe('a.md')
    expect(second.lessons[0].name).toBe('b.md')
    expect(cachedFirst.lessons[0].name).toBe('a.md')
    expect((search as ReturnType<typeof mock>).mock.calls.length).toBe(2) // third call was a cache hit
  })

  it('reports engine-down honestly and never throws', async () => {
    const down = mock().mockResolvedValue({ results: [], meta: { source: 'unavailable' } }) as never
    expect(await retrieveBrandLessons('acme', 'anything', down)).toEqual({ status: 'unavailable' })

    const throwing = mock().mockRejectedValue(new Error('boom')) as never
    __resetBrandLessonCache()
    expect(await retrieveBrandLessons('acme', 'anything', throwing)).toEqual({ status: 'unavailable' })
  })
})
