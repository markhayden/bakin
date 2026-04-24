/**
 * Workflows plugin — file-backed search hook test.
 *
 * Verifies that the workflows plugin registers a single file-backed content
 * type with TWO filePatterns:
 *   - workflows/definitions/*.{yaml,yml} → key `def:{name}`
 *   - workflows/instances/*.json         → key `inst:{taskId}`
 *
 * Each mapper is exercised directly. The watcher is not driven here — that
 * integration is covered in tests/integration/.
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

const testDir = join(tmpdir(), `bakin-test-workflows-sync-${Date.now()}`)
const defsDir = join(testDir, 'workflows', 'definitions')
const instancesDir = join(testDir, 'workflows', 'instances')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
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

mock.module('../../../src/core/discord-gateway', () => ({
  startGateway: mock(),
  stopGateway: mock(),
  onGateInteraction: mock(),
  isGatewayConnected: mock(() => false),
}))

mock.module('../../../scripts/lib/post-discord', () => ({
  loadDiscordConfig: mock(() => null),
}))

mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: mock(() => Promise.resolve({ id: 'mock-task' })),
  addTaskLog: mock(() => Promise.resolve()),
  moveTask: mock(() => Promise.resolve()),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

import workflowsPlugin from '../../../plugins/workflows'

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
  mkdirSync(defsDir, { recursive: true })
  mkdirSync(instancesDir, { recursive: true })

  const indexCalls: Array<{ key: string; doc: Record<string, unknown> }> = []
  const removeCalls: string[] = []
  let capturedDef: FileBackedContentTypeDefinition | null = null

  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId: 'workflows',
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

const SAMPLE_DEF = `name: Sample Flow
description: A sample workflow
steps:
  - id: step-one
    type: agent
    label: First step
    agent: writer
    prompt: do the thing
`

const SAMPLE_INSTANCE = (taskId: string) => JSON.stringify({
  taskId,
  workflowId: 'sample',
  status: 'running',
  currentStepIndex: 0,
  stepStates: {},
  updatedAt: '2026-04-12T00:00:00.000Z',
})

describe('workflows plugin — file-backed sync hook', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })
  })

  it('registers a file-backed content type with TWO filePatterns', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    expect(captured.ctx.search.registerFileBackedContentType).toHaveBeenCalledTimes(1)
    expect(captured.capturedDef).not.toBeNull()
    expect(captured.capturedDef!.table).toBe('workflows')
    expect(captured.capturedDef!.filePatterns).toHaveLength(2)
    const patterns = captured.capturedDef!.filePatterns.map(p => p.pattern).sort()
    expect(patterns).toEqual([
      'workflows/definitions/*.{yaml,yml}',
      'workflows/instances/*.json',
    ])
  })

  it('definition mapper.fileToId returns def: prefixed key for both yaml and yml', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    const defMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/definitions')
    )!
    expect(defMapper.fileToId('workflows/definitions/my-flow.yaml')).toBe('def:my-flow')
    expect(defMapper.fileToId('workflows/definitions/other.yml')).toBe('def:other')
  })

  it('definition mapper.fileToDoc returns null when file is missing', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    const defMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/definitions')
    )!
    const doc = await defMapper.fileToDoc('workflows/definitions/missing.yaml', '')
    expect(doc).toBeNull()
  })

  it('definition mapper.fileToDoc returns search doc when file exists', async () => {
    const captured = makeCtx()
    writeFileSync(join(defsDir, 'sample.yaml'), SAMPLE_DEF)
    await workflowsPlugin.activate(captured.ctx)
    const defMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/definitions')
    )!
    const doc = await defMapper.fileToDoc('workflows/definitions/sample.yaml', SAMPLE_DEF)
    expect(doc).not.toBeNull()
    expect(doc!.name).toBe('Sample Flow')
    expect(doc!.type).toBe('definition')
  })

  it('instance mapper.fileToId returns inst: prefixed key', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    const instMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/instances')
    )!
    expect(instMapper.fileToId('workflows/instances/task-42.json')).toBe('inst:task-42')
  })

  it('instance mapper.fileToDoc parses content and returns search doc', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    const instMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/instances')
    )!
    const doc = await instMapper.fileToDoc('workflows/instances/task-42.json', SAMPLE_INSTANCE('task-42'))
    expect(doc).not.toBeNull()
    expect(doc!.type).toBe('instance')
    expect(doc!.task_id).toBe('task-42')
    expect(doc!.status).toBe('running')
  })

  it('instance mapper.fileToDoc returns null on malformed JSON', async () => {
    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)
    const instMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/instances')
    )!
    const doc = await instMapper.fileToDoc('workflows/instances/broken.json', '{not json')
    expect(doc).toBeNull()
  })

  it('reindex generator yields both definitions and instances', async () => {
    writeFileSync(join(defsDir, 'one.yaml'), SAMPLE_DEF.replace('Sample Flow', 'One'))
    writeFileSync(join(defsDir, 'two.yml'), SAMPLE_DEF.replace('Sample Flow', 'Two'))
    writeFileSync(join(instancesDir, 'task-1.json'), SAMPLE_INSTANCE('task-1'))
    writeFileSync(join(instancesDir, 'task-2.json'), SAMPLE_INSTANCE('task-2'))

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    for await (const item of captured.capturedDef!.reindex()) {
      yielded.push(item as { key: string; doc: Record<string, unknown> })
    }
    const keys = yielded.map(y => y.key).sort()
    expect(keys).toEqual(['def:one', 'def:two', 'inst:task-1', 'inst:task-2'])
  })

  it('verifyExists handles def: keys (yaml and yml) and inst: keys', async () => {
    writeFileSync(join(defsDir, 'present.yaml'), SAMPLE_DEF)
    writeFileSync(join(defsDir, 'present-yml.yml'), SAMPLE_DEF)
    writeFileSync(join(instancesDir, 'task-99.json'), SAMPLE_INSTANCE('task-99'))

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    expect(await captured.capturedDef!.verifyExists!('def:present')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('def:present-yml')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('def:missing')).toBe(false)
    expect(await captured.capturedDef!.verifyExists!('inst:task-99')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('inst:task-nope')).toBe(false)
    expect(await captured.capturedDef!.verifyExists!('unknown:foo')).toBe(false)
  })
})
