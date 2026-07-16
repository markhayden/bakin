/**
 * Tests for the team plugin's agent-lessons search content type (Phase F-4).
 *
 * The team plugin registers a `agent-lessons` table that indexes lesson
 * markdown files shipped by installed agent-packages. This test exercises
 * the path-parsing, frontmatter extraction, and reindex generator that
 * back the registration — without booting the full plugin (which would
 * require Antfly running).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-team-lessons-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

function seedLessonFile(packageId: string, version: string, lessonId: string, body: {
  title?: string
  tags?: string[]
  defaultEnabled?: boolean
  bodyText?: string
}): string {
  const dir = join(testDir, 'packages', 'agents', `${packageId}@${version}`, 'lessons')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${lessonId}.md`)
  const lines = ['---']
  if (body.title !== undefined) lines.push(`title: ${body.title}`)
  if (body.tags !== undefined) lines.push(`tags: [${body.tags.map((t) => JSON.stringify(t)).join(', ')}]`)
  if (body.defaultEnabled !== undefined) lines.push(`defaultEnabled: ${body.defaultEnabled}`)
  lines.push('---', '', body.bodyText ?? '')
  writeFileSync(path, lines.join('\n'))
  return path
}

describe('team plugin: agent-lessons content type registration', () => {
  it('is registered when the team plugin activates', async () => {
    const teamPlugin = (await import('../../../plugins/team/index')).default

    // Build a minimal mock context that captures registerFileBackedContentType calls.
    const captured: Array<{ table: string; def: { facets?: string[]; filePatterns?: { pattern: string }[] } }> = []
    const execTools: string[] = []
    const ctx = {
      pluginId: 'team',
      registerNav: () => {},
      registerRoute: () => {},
      registerSlot: () => {},
      registerExecTool: (tool: { name: string }) => { execTools.push(tool.name) },
      registerSkill: () => {},
      registerWorkflow: () => {},
      registerNodeType: () => {},
      registerNotificationChannel: () => {},
      registerHealthCheck: () => {},
      registerHealthRepairAction: () => {},
      watchFiles: () => {},
      getSettings: <T>() => ({} as T),
      updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      hooks: { register: () => {}, has: () => false, invoke: async () => undefined },
      events: { on: () => {}, emit: () => {} },
      storage: {} as never,
      search: {
        registerContentType: (def: { table: string }) => {
          captured.push({ table: def.table, def: def as never })
        },
        registerFileBackedContentType: (def: { table: string; facets?: string[]; filePatterns?: { pattern: string }[] }) => {
          captured.push({ table: def.table, def })
        },
        index: async () => {},
        remove: async () => {},
        transform: async () => {},
        query: async () => ({ results: [] }),
      },
    }

    teamPlugin.activate(ctx as never)

    const lessons = captured.find((c) => c.table === 'agent-lessons')
    expect(lessons).toBeDefined()
    expect(lessons!.def.facets).toContain('package_id')
    expect(lessons!.def.facets).toContain('agent_id')
    expect(lessons!.def.filePatterns?.[0].pattern).toBe('packages/agents/*/lessons/*.md')
    expect(execTools).toContain('bakin_exec_lesson_search')
  })
})

describe('team plugin: lesson file → search doc conversion', () => {
  it('reindex generator yields one entry per lesson file with parsed frontmatter', async () => {
    seedLessonFile('pixel', '0.1.0', 'style', {
      title: 'Style System',
      tags: ['core', 'aesthetics'],
      defaultEnabled: true,
      bodyText: 'How Pixel thinks about style.',
    })
    seedLessonFile('pixel', '0.1.0', 'social', {
      title: 'Social Media',
      tags: ['social'],
      defaultEnabled: false,
      bodyText: 'Viral patterns.',
    })
    // Different package
    seedLessonFile('rolo', '0.1.0', 'pacing', {
      title: 'Video Pacing',
      defaultEnabled: true,
      bodyText: 'Cuts.',
    })

    // Capture the reindex generator from the registration
    let reindexGen: AsyncGenerator<{ key: string; doc: Record<string, unknown> }> | undefined
    const teamPlugin = (await import('../../../plugins/team/index')).default
    const ctx = {
      pluginId: 'team',
      registerNav: () => {},
      registerRoute: () => {},
      registerSlot: () => {},
      registerExecTool: () => {},
      registerSkill: () => {},
      registerWorkflow: () => {},
      registerNodeType: () => {},
      registerNotificationChannel: () => {},
      registerHealthCheck: () => {},
      registerHealthRepairAction: () => {},
      watchFiles: () => {},
      getSettings: <T>() => ({} as T),
      updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      hooks: { register: () => {}, has: () => false, invoke: async () => undefined },
      events: { on: () => {}, emit: () => {} },
      storage: {} as never,
      search: {
        registerContentType: () => {},
        registerFileBackedContentType: (def: { table: string; reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }> }) => {
          if (def.table === 'agent-lessons') reindexGen = def.reindex()
        },
        index: async () => {},
        remove: async () => {},
        transform: async () => {},
        query: async () => ({ results: [] }),
      },
    }
    teamPlugin.activate(ctx as never)
    expect(reindexGen).toBeDefined()

    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    if (reindexGen) {
      for await (const entry of reindexGen) {
        yielded.push(entry)
      }
    }

    expect(yielded).toHaveLength(3)
    const byKey = new Map(yielded.map((y) => [y.key, y.doc]))
    expect(byKey.has('pixel@0.1.0/style')).toBe(true)
    expect(byKey.has('pixel@0.1.0/social')).toBe(true)
    expect(byKey.has('rolo@0.1.0/pacing')).toBe(true)

    const styleDoc = byKey.get('pixel@0.1.0/style')!
    expect(styleDoc.title).toBe('Style System')
    expect(styleDoc.body).toBe('How Pixel thinks about style.')
    expect(styleDoc.package_id).toBe('pixel')
    expect(styleDoc.agent_id).toBe('pixel')
    expect(styleDoc.lesson_id).toBe('style')
    expect(styleDoc.tags).toEqual(['core', 'aesthetics'])
    expect(styleDoc.default_enabled).toBe('true')

    const socialDoc = byKey.get('pixel@0.1.0/social')!
    expect(socialDoc.default_enabled).toBe('false')
  })

  it('handles lesson files without frontmatter (treats whole file as body)', async () => {
    seedLessonFile('pixel', '0.1.0', 'no-fm', { bodyText: '' })
    // Now overwrite to have NO frontmatter
    const path = join(testDir, 'packages', 'agents', 'pixel@0.1.0', 'lessons', 'no-fm.md')
    writeFileSync(path, 'Just a plain body, no frontmatter.')

    const teamPlugin = (await import('../../../plugins/team/index')).default
    let reindexGen: AsyncGenerator<{ key: string; doc: Record<string, unknown> }> | undefined
    const ctx = {
      pluginId: 'team',
      registerNav: () => {}, registerRoute: () => {}, registerSlot: () => {},
      registerExecTool: () => {}, registerSkill: () => {}, registerWorkflow: () => {},
      registerNodeType: () => {}, registerNotificationChannel: () => {},
      registerHealthCheck: () => {}, registerHealthRepairAction: () => {}, watchFiles: () => {},
      getSettings: <T>() => ({} as T), updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      hooks: { register: () => {}, has: () => false, invoke: async () => undefined },
      events: { on: () => {}, emit: () => {} }, storage: {} as never,
      search: {
        registerContentType: () => {},
        registerFileBackedContentType: (def: { table: string; reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }> }) => {
          if (def.table === 'agent-lessons') reindexGen = def.reindex()
        },
        index: async () => {}, remove: async () => {}, transform: async () => {},
        query: async () => ({ results: [] }),
      },
    }
    teamPlugin.activate(ctx as never)

    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    if (reindexGen) {
      for await (const entry of reindexGen) yielded.push(entry)
    }
    expect(yielded).toHaveLength(1)
    const doc = yielded[0].doc
    expect(doc.title).toBe('no-fm') // falls back to lessonId
    expect(doc.body).toBe('Just a plain body, no frontmatter.')
    expect(doc.tags).toEqual([])
    expect(doc.default_enabled).toBe('false')
  })

  it('skips non-conforming paths in the packages dir', async () => {
    // Create a malformed path (no @ in the dir name)
    const dir = join(testDir, 'packages', 'agents', 'pixel-no-version', 'lessons')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'lesson.md'), '---\ntitle: test\n---\nbody')

    const teamPlugin = (await import('../../../plugins/team/index')).default
    let reindexGen: AsyncGenerator<{ key: string; doc: Record<string, unknown> }> | undefined
    const ctx = {
      pluginId: 'team',
      registerNav: () => {}, registerRoute: () => {}, registerSlot: () => {},
      registerExecTool: () => {}, registerSkill: () => {}, registerWorkflow: () => {},
      registerNodeType: () => {}, registerNotificationChannel: () => {},
      registerHealthCheck: () => {}, registerHealthRepairAction: () => {}, watchFiles: () => {},
      getSettings: <T>() => ({} as T), updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      hooks: { register: () => {}, has: () => false, invoke: async () => undefined },
      events: { on: () => {}, emit: () => {} }, storage: {} as never,
      search: {
        registerContentType: () => {},
        registerFileBackedContentType: (def: { table: string; reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }> }) => {
          if (def.table === 'agent-lessons') reindexGen = def.reindex()
        },
        index: async () => {}, remove: async () => {}, transform: async () => {},
        query: async () => ({ results: [] }),
      },
    }
    teamPlugin.activate(ctx as never)

    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    if (reindexGen) {
      for await (const entry of reindexGen) yielded.push(entry)
    }
    expect(yielded).toHaveLength(0)
  })
})

void readFileSync // silence unused-import warning
void existsSync
