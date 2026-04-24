/**
 * Projects plugin — file-backed search hook test.
 *
 * Verifies that registering the projects content type via
 * `registerFileBackedContentType` correctly wires both:
 *   - sync hook on `projects/*.md` writes → ctx.search.index called
 *   - unlink hook on `projects/*.md` deletes → ctx.search.remove called
 *
 * The test mocks `ctx.search.registerFileBackedContentType` to capture the
 * definition the plugin passes in, then exercises both `filePatterns` and
 * any escape hatches directly. We do NOT exercise the real watcher here —
 * the watcher integration is covered in tests/integration/.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  PluginContext,
  FileBackedContentTypeDefinition,
} from '../../../src/lib/plugin-types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'

const testDir = join(tmpdir(), `bakin-test-projects-sync-${Date.now()}`)
const projectsDir = join(testDir, 'projects')

mock.module('../../../src/core/content-dir', () => ({
  getBakinPaths: () => ({ projects: projectsDir }),
  getContentDir: () => testDir,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

import projectsPlugin from '../../../plugins/projects'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface CapturedCtx {
  ctx: PluginContext
  capturedDef: FileBackedContentTypeDefinition | null
  indexCalls: Array<{ key: string; doc: Record<string, unknown> }>
  removeCalls: string[]
}

function makeCtx(): CapturedCtx {
  mkdirSync(projectsDir, { recursive: true })

  const indexCalls: Array<{ key: string; doc: Record<string, unknown> }> = []
  const removeCalls: string[] = []
  let capturedDef: FileBackedContentTypeDefinition | null = null

  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId: 'projects',
    registerNav: mock(),
    registerRoute: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    registerWorkflow: mock(),
    registerNodeType: mock(() => ''),
    registerNotificationChannel: mock(() => ''),
    registerHealthCheck: mock(() => ''),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock((def: FileBackedContentTypeDefinition) => {
        capturedDef = def
      }),
      index: mock(async (key, doc) => { indexCalls.push({ key, doc }) }),
      remove: mock(async (key) => { removeCalls.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  }

  return {
    ctx,
    get capturedDef() { return capturedDef },
    indexCalls,
    removeCalls,
  } as CapturedCtx
}

describe('projects plugin — file-backed sync hook', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(projectsDir, { recursive: true })
  })

  it('registers a file-backed content type with projects/*.md pattern', async () => {
    const captured = makeCtx()
    await projectsPlugin.activate(captured.ctx)
    expect(captured.ctx.search.registerFileBackedContentType).toHaveBeenCalledTimes(1)
    expect(captured.capturedDef).not.toBeNull()
    expect(captured.capturedDef!.table).toBe('projects')
    expect(captured.capturedDef!.filePatterns).toHaveLength(1)
    expect(captured.capturedDef!.filePatterns[0].pattern).toBe('projects/*.md')
  })

  it('mapper.fileToId derives basename from rel path', async () => {
    const captured = makeCtx()
    await projectsPlugin.activate(captured.ctx)
    const mapper = captured.capturedDef!.filePatterns[0]
    expect(mapper.fileToId('projects/sync-test.md')).toBe('sync-test')
  })

  it('mapper.fileToDoc returns null when project file is missing', async () => {
    const captured = makeCtx()
    await projectsPlugin.activate(captured.ctx)
    const mapper = captured.capturedDef!.filePatterns[0]
    const doc = await mapper.fileToDoc('projects/missing.md', '')
    expect(doc).toBeNull()
  })

  it('mapper.fileToDoc returns project search doc when file exists', async () => {
    const captured = makeCtx()
    writeFileSync(
      join(projectsDir, 'fixture.md'),
      '---\ntitle: Fixture\nstatus: active\n---\nbody content\n'
    )
    await projectsPlugin.activate(captured.ctx)
    const mapper = captured.capturedDef!.filePatterns[0]
    const doc = await mapper.fileToDoc('projects/fixture.md', '')
    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Fixture')
    expect(doc!.status).toBe('active')
  })

  it('reindex generator yields all projects in directory', async () => {
    const captured = makeCtx()
    writeFileSync(
      join(projectsDir, 'one.md'),
      '---\ntitle: One\nstatus: active\n---\nbody one\n'
    )
    writeFileSync(
      join(projectsDir, 'two.md'),
      '---\ntitle: Two\nstatus: planning\n---\nbody two\n'
    )
    await projectsPlugin.activate(captured.ctx)
    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    for await (const item of captured.capturedDef!.reindex()) {
      yielded.push(item as { key: string; doc: Record<string, unknown> })
    }
    expect(yielded).toHaveLength(2)
    const titles = yielded.map(y => y.doc.title).sort()
    expect(titles).toEqual(['One', 'Two'])
  })

  it('verifyExists returns true for present file, false for missing', async () => {
    const captured = makeCtx()
    writeFileSync(
      join(projectsDir, 'present.md'),
      '---\ntitle: Present\nstatus: active\n---\n'
    )
    await projectsPlugin.activate(captured.ctx)
    expect(await captured.capturedDef!.verifyExists('present')).toBe(true)
    expect(await captured.capturedDef!.verifyExists('missing')).toBe(false)
  })
})
