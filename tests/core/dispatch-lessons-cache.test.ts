/**
 * Tests for the dispatch lesson-block cache and the lesson formatting fixes
 * (no silent drops: whole-lesson minimum + omission marker).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-lessons-cache-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ tasks: join(testDir, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ tasks: join(testDir, 'tasks') }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: { intervalMs: 1000, maxRetries: 3, failureCooldownMs: 60000, transientCooldownMs: 5000, maxDispatched: 500 },
    agents: ['main', 'pixel'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
    agentPackages: { lessonsRetrieval: { enabled: true, injectIntoDispatch: true, maxLessons: 3, maxCharacters: 8000 } },
  }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('../../src/lib/format', () => ({ isStale: mock().mockReturnValue(true) }))

const retrieveSpy = mock(async (_opts: Record<string, unknown>) => ({
  lessons: [
    {
      packageId: 'pkg-1',
      agentId: 'pixel',
      lessonId: 'lesson-1',
      title: 'Lesson One',
      body: 'Always do the thing the right way.',
      tags: [],
      score: 0.9,
    },
  ],
  packageId: 'pkg-1',
}))

mock.module('../../src/core/agent-packages/lesson-retrieval', () => ({
  retrieveAgentPackageLessons: retrieveSpy,
  formatLessonsForDispatch: (lessons: Array<{ title: string; body: string }>) =>
    lessons.length === 0 ? '' : `## Relevant Package Lessons\n\n${lessons.map(l => `### ${l.title}\n${l.body}`).join('\n')}`,
  buildTaskLessonQuery: (input: { title: string; description?: string; instructions?: string; context?: string }) =>
    [input.title, input.description, input.instructions, input.context].filter(Boolean).join('\n\n'),
}))

import { buildDispatchLessonBlock, __resetLessonBlockCache } from '../../src/core/dispatch'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  retrieveSpy.mockClear()
  __resetLessonBlockCache()
})

describe('dispatch lesson-block cache', () => {
  const base = { contentDir: testDir, taskId: 't-1', title: 'Task', agentId: 'pixel', query: 'Task\n\nmake it' }

  it('two builds with the same agent+query hit the search once', async () => {
    const first = await buildDispatchLessonBlock(base)
    const second = await buildDispatchLessonBlock(base)
    expect(first).toContain('Lesson One')
    expect(second).toBe(first)
    expect(retrieveSpy.mock.calls.length).toBe(1)
  })

  it('a changed query (e.g. workflow step change) misses the cache', async () => {
    await buildDispatchLessonBlock(base)
    await buildDispatchLessonBlock({ ...base, query: 'Task\n\nreview it instead' })
    expect(retrieveSpy.mock.calls.length).toBe(2)
  })

  it('a different agent misses the cache', async () => {
    await buildDispatchLessonBlock(base)
    await buildDispatchLessonBlock({ ...base, agentId: 'main' })
    expect(retrieveSpy.mock.calls.length).toBe(2)
  })

  it('empty results are cached too (no re-query for lesson-less agents)', async () => {
    retrieveSpy.mockResolvedValueOnce({ lessons: [], packageId: undefined, reason: 'no-package' } as never)
    const first = await buildDispatchLessonBlock(base)
    const second = await buildDispatchLessonBlock(base)
    expect(first).toBe('')
    expect(second).toBe('')
    expect(retrieveSpy.mock.calls.length).toBe(1)
  })
})
