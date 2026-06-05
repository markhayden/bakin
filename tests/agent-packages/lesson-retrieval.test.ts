import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { SearchResponse } from '../../packages/core/src/plugin-types'

const mockHome = join(tmpdir(), `bakin-lesson-retrieval-home-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ tasks: join(mockHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ tasks: join(mockHome, 'tasks') }),
}))
import {
  formatLessonsForDispatch,
  retrieveAgentPackageLessons,
  type LessonSearchFn,
} from '../../src/core/agent-packages/lesson-retrieval'

const testDir = join(tmpdir(), `bakin-lesson-retrieval-${Date.now()}-${randomUUID()}`)

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('agent package lessons retrieval', () => {
  it('selects top enabled lessons for the target package and hydrates full bodies from disk', async () => {
    seedAgentPackage('pixel', '0.1.0', ['style', 'craft'])
    seedLesson('pixel', '0.1.0', 'style', {
      title: 'Style System',
      tags: ['visual', 'prompting'],
      body: 'Full style lesson body from disk.',
    })
    seedLesson('pixel', '0.1.0', 'craft', {
      title: 'Craft Notes',
      tags: ['quality'],
      body: 'Full craft lesson body from disk.',
    })
    seedLesson('pixel', '0.1.0', 'disabled', {
      title: 'Disabled',
      tags: [],
      body: 'Should not appear.',
    })

    const calls: Array<{ q: string; opts: Parameters<LessonSearchFn>[1] }> = []
    const search: LessonSearchFn = async (q, opts) => {
      calls.push({ q, opts })
      return response([
        hit('disabled', 0.99, { package_id: 'pixel', lesson_id: 'disabled', title: 'Disabled', body: 'disabled chunk' }),
        hit('other', 0.95, { package_id: 'rolo', lesson_id: 'pacing', title: 'Pacing', body: 'wrong package' }),
        hit('style', 0.86, { package_id: 'pixel', lesson_id: 'style', title: 'Style chunk', body: 'chunk body' }),
        hit('craft', 0.72, { package_id: 'pixel', lesson_id: 'craft', title: 'Craft chunk', body: 'chunk body' }),
        hit('style-duplicate', 0.4, { package_id: 'pixel', lesson_id: 'style', title: 'Duplicate', body: 'duplicate chunk' }),
      ])
    }

    const result = await retrieveAgentPackageLessons({
      contentDir: testDir,
      agentId: 'pixel',
      query: 'make a polished social image',
      settings: { maxLessons: 2 },
      search,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].opts.table).toBe('agent-lessons')
    expect(calls[0].opts.filters).toEqual({ package_id: 'pixel' })
    expect(result.packageId).toBe('pixel')
    expect(result.lessons.map((lesson) => lesson.lessonId)).toEqual(['style', 'craft'])
    expect(result.lessons[0].title).toBe('Style System')
    expect(result.lessons[0].body).toBe('Full style lesson body from disk.')
    expect(result.lessons[0].tags).toEqual(['visual', 'prompting'])

    const block = formatLessonsForDispatch(result.lessons)
    expect(block).toContain('## Relevant Package Lessons')
    expect(block).toContain('Style System')
    expect(block).toContain('Full craft lesson body from disk.')
    expect(block).not.toContain('Should not appear')
  })

  it('does not query search when the agent is not package-managed', async () => {
    let searched = false
    const result = await retrieveAgentPackageLessons({
      contentDir: testDir,
      agentId: 'unmanaged',
      query: 'anything',
      search: async () => {
        searched = true
        return response([])
      },
    })

    expect(searched).toBe(false)
    expect(result.reason).toBe('no-package')
    expect(result.lessons).toEqual([])
  })

  it('respects minScore and injection budget', async () => {
    seedAgentPackage('patch', '0.1.0', ['dev-discipline'])
    seedLesson('patch', '0.1.0', 'dev-discipline', {
      title: 'Dev Discipline',
      tags: [],
      body: 'A'.repeat(5000),
    })

    const result = await retrieveAgentPackageLessons({
      contentDir: testDir,
      agentId: 'patch',
      query: 'implementation task',
      settings: { minScore: 0.5 },
      search: async () => response([
        hit('dev-discipline', 0.4, { package_id: 'patch', lesson_id: 'dev-discipline', title: 'Dev Discipline', body: 'chunk' }),
      ]),
    })
    expect(result.lessons).toEqual([])

    const selected = await retrieveAgentPackageLessons({
      contentDir: testDir,
      agentId: 'patch',
      query: 'implementation task',
      search: async () => response([
        hit('dev-discipline', 0.9, { package_id: 'patch', lesson_id: 'dev-discipline', title: 'Dev Discipline', body: 'chunk' }),
      ]),
    })
    const block = formatLessonsForDispatch(selected.lessons, 1200)
    expect(block.length).toBeLessThanOrEqual(1300)
    expect(block).toContain('[truncated]')
  })

  it('omits lessons that cannot fit a meaningful minimum whole — with a visible marker', () => {
    const mkLesson = (id: string, bodyLen: number) => ({
      packageId: 'patch',
      agentId: 'patch',
      lessonId: id,
      title: `Lesson ${id}`,
      body: 'B'.repeat(bodyLen),
      tags: [],
      score: 0.9,
    })
    // First lesson eats most of a small budget; the rest can't fit ≥400 chars.
    const block = formatLessonsForDispatch(
      [mkLesson('one', 700), mkLesson('two', 700), mkLesson('three', 700)],
      1000,
    )
    expect(block).toContain('Lesson one')
    // Dropped lessons are announced, never silent.
    expect(block).toMatch(/\(\d+ lessons? omitted/)
    expect(block).not.toContain('Lesson three')
  })

  it('never truncates a lesson body below the 400-char minimum', () => {
    const lessons = [
      {
        packageId: 'patch', agentId: 'patch', lessonId: 'big', title: 'Big',
        body: 'C'.repeat(5000), tags: [], score: 0.9,
      },
      {
        packageId: 'patch', agentId: 'patch', lessonId: 'next', title: 'Next',
        body: 'D'.repeat(5000), tags: [], score: 0.8,
      },
    ]
    const block = formatLessonsForDispatch(lessons, 1200)
    // The second lesson would have ≲ a hundred chars left — it must be
    // omitted (with marker), not truncated into a useless stub.
    const dBody = block.match(/D+/)?.[0] ?? ''
    expect(dBody.length === 0 || dBody.length >= 400).toBe(true)
    expect(block).toMatch(/\(1 lesson omitted/)
  })

  it('a small lesson that fits whole under the 400 threshold is still included', () => {
    const lessons = [
      {
        packageId: 'patch', agentId: 'patch', lessonId: 'big', title: 'Big',
        body: 'C'.repeat(800), tags: [], score: 0.9,
      },
      {
        packageId: 'patch', agentId: 'patch', lessonId: 'tiny', title: 'Tiny',
        body: 'tiny but complete lesson.', tags: [], score: 0.8,
      },
    ]
    // Budget leaves ~150 chars after the big lesson: too small to truncate
    // another big body into, but plenty for the tiny lesson to fit WHOLE.
    const block = formatLessonsForDispatch(lessons, 1200)
    expect(block).toContain('tiny but complete lesson.')
    expect(block).not.toMatch(/omitted/)
  })

  it('skips stale search hits when the enabled lesson file is missing on disk', async () => {
    seedAgentPackage('patch', '0.1.0', ['dev-discipline'])

    const result = await retrieveAgentPackageLessons({
      contentDir: testDir,
      agentId: 'patch',
      query: 'implementation task',
      search: async () => response([
        hit('dev-discipline', 0.99, {
          package_id: 'patch',
          lesson_id: 'dev-discipline',
          title: 'Dev Discipline',
          body: 'Stale indexed body that no longer exists on disk.',
        }),
      ]),
    })

    expect(result.packageId).toBe('patch')
    expect(result.lessons).toEqual([])
    expect(formatLessonsForDispatch(result.lessons)).toBe('')
  })
})

function seedAgentPackage(agentId: string, version: string, lessonsEnabled: string[]): void {
  const lockPath = join(testDir, 'packages', 'lock.json')
  mkdirSync(join(testDir, 'packages'), { recursive: true })
  writeFileSync(lockPath, JSON.stringify({
    version: 1,
    packages: {
      [agentId]: {
        kind: 'agent',
        version,
        source: `local:${agentId}`,
        ref: 'main',
        commitSha: 'test',
        installedAt: '2026-04-30T00:00:00.000Z',
        state: 'managed',
        agentId,
        lessonsEnabled,
      },
    },
  }, null, 2))
}

function seedLesson(packageId: string, version: string, lessonId: string, input: {
  title: string
  tags: string[]
  body: string
}): void {
  const dir = join(testDir, 'packages', 'agents', `${packageId}@${version}`, 'lessons')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${lessonId}.md`), [
    '---',
    `title: ${input.title}`,
    `tags: [${input.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    '---',
    '',
    input.body,
  ].join('\n'))
}

function response(results: SearchResponse['results']): SearchResponse {
  return {
    results,
    meta: {
      query: 'test',
      total: results.length,
      took_ms: 1,
      source: 'search',
    },
  }
}

function hit(id: string, score: number, fields: Record<string, unknown>): SearchResponse['results'][number] {
  return {
    id,
    table: 'bakin_agent-lessons',
    score,
    fields,
  }
}
