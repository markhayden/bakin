import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { SearchResponse } from '../../packages/core/src/plugin-types'
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
