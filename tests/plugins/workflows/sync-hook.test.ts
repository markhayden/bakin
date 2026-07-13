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
} from '@bakin/core/plugin-types'
import type { WorkflowDefinition } from '../../../plugins/workflows/types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

const testDir = join(tmpdir(), `bakin-test-workflows-sync-${Date.now()}`)
const defsDir = join(testDir, 'workflows', 'definitions')
const instancesDir = join(testDir, 'workflows', 'instances')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
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

mock.module('@/core/task-store', () => ({
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
import { clearSourceRegistry, registerPluginDefinition } from '@bakin/core/workflows/source-registry'
import { resetWorkflowAvailabilityCache, setWorkflowDisabled } from '../../../plugins/workflows/lib/availability'

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
    runtime: createMockRuntimeAdapter(),
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    assets: {
      createAsset: mock(async () => ({ assetId: 'test-asset', version: 1 })),
      getAsset: mock(async () => null),
      addVersion: mock(async () => ({ assetId: 'test-asset', version: 2 })),
      addExport: mock(async () => ({ name: 'export', file: 'exports/export.jpg' })),
      resolveVersionFile: mock(async () => null),
      listAssets: mock(async () => []),
      getAssetVersions: mock(async () => null),
      upsertFromSource: mock(async () => ({ assetId: 'test-asset', version: 1, changed: true })),
      resolveStoreFile: mock(async () => null),
    },
    registerNav: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    registerWorkflow: mock(),
    registerNodeType: mock(() => ''),
    registerNotificationChannel: mock(() => ''),
    registerHealthCheck: mock(() => ''),
    registerHealthRepairAction: mock(() => ''),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    log: { debug: mock(), info: mock(), warn: mock(), error: mock() },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock((def: FileBackedContentTypeDefinition) => {
        capturedDef = def
      }),
      index: mock(async (key, doc) => { indexCalls.push({ key, doc }) }),
      remove: mock(async (key) => { removeCalls.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
    },
    hooks: {
      register: mock(() => () => {}),
      call: mock(async (_name, data) => data),
      callAll: mock(async () => undefined),
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

const MANAGED_DEF: WorkflowDefinition = {
  name: 'Managed Flow',
  description: 'A plugin-shipped workflow',
  version: 1,
  steps: [
    {
      id: 'managed-step',
      type: 'agent',
      label: 'Managed step',
      agent: 'writer',
      prompt: 'run managed step',
    },
  ],
}

describe('workflows plugin — file-backed sync hook', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })
    clearSourceRegistry()
    resetWorkflowAvailabilityCache()
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
    const doc = await defMapper.fileToDoc!('workflows/definitions/missing.yaml', '')
    expect(doc).toBeNull()
  })

  it('definition mapper.fileToDoc returns search doc when file exists', async () => {
    const captured = makeCtx()
    writeFileSync(join(defsDir, 'sample.yaml'), SAMPLE_DEF)
    await workflowsPlugin.activate(captured.ctx)
    const defMapper = captured.capturedDef!.filePatterns.find(p =>
      p.pattern.startsWith('workflows/definitions')
    )!
    const doc = await defMapper.fileToDoc!('workflows/definitions/sample.yaml', SAMPLE_DEF)
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
    const doc = await instMapper.fileToDoc!('workflows/instances/task-42.json', SAMPLE_INSTANCE('task-42'))
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
    const doc = await instMapper.fileToDoc!('workflows/instances/broken.json', '{not json')
    expect(doc).toBeNull()
  })

  it('reindex generator yields effective definitions from every source and instances', async () => {
    writeFileSync(join(defsDir, 'one.yaml'), SAMPLE_DEF.replace('Sample Flow', 'One'))
    writeFileSync(join(defsDir, 'two.yml'), SAMPLE_DEF.replace('Sample Flow', 'Two'))
    writeFileSync(join(instancesDir, 'task-1.json'), SAMPLE_INSTANCE('task-1'))
    writeFileSync(join(instancesDir, 'task-2.json'), SAMPLE_INSTANCE('task-2'))
    registerPluginDefinition('workflows', 'managed', MANAGED_DEF)

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    const yielded: Array<{ key: string; doc: Record<string, unknown>; mtimeMs?: number }> = []
    for await (const item of captured.capturedDef!.reindex()) {
      yielded.push(item as { key: string; doc: Record<string, unknown>; mtimeMs?: number })
    }
    const keys = yielded.map(y => y.key).sort()
    expect(keys).toEqual(['def:managed', 'def:one', 'def:two', 'inst:task-1', 'inst:task-2'])
    const managed = yielded.find(y => y.key === 'def:managed')
    expect(managed?.doc).toMatchObject({
      name: 'Managed Flow',
      type: 'definition',
      status: 'active',
    })
  })

  it('indexes a user shadow as active even when the managed fallback is disabled', async () => {
    registerPluginDefinition('workflows', 'shadowed', MANAGED_DEF)
    setWorkflowDisabled('shadowed', true)
    writeFileSync(join(defsDir, 'shadowed.yaml'), SAMPLE_DEF.replace('Sample Flow', 'User Shadow'))

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    const yielded: Array<{ key: string; doc: Record<string, unknown> }> = []
    for await (const item of captured.capturedDef!.reindex()) {
      yielded.push(item as { key: string; doc: Record<string, unknown> })
    }

    expect(yielded.find(y => y.key === 'def:shadowed')?.doc).toMatchObject({
      name: 'User Shadow',
      type: 'definition',
      status: 'active',
    })
  })

  it('verifyExists handles def: keys (yaml and yml) and inst: keys', async () => {
    writeFileSync(join(defsDir, 'present.yaml'), SAMPLE_DEF)
    writeFileSync(join(defsDir, 'present-yml.yml'), SAMPLE_DEF)
    writeFileSync(join(instancesDir, 'task-99.json'), SAMPLE_INSTANCE('task-99'))
    registerPluginDefinition('workflows', 'managed', MANAGED_DEF)

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    expect(await captured.capturedDef!.verifyExists!('def:present')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('def:present-yml')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('def:managed')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('def:missing')).toBe(false)
    expect(await captured.capturedDef!.verifyExists!('inst:task-99')).toBe(true)
    expect(await captured.capturedDef!.verifyExists!('inst:task-nope')).toBe(false)
    expect(await captured.capturedDef!.verifyExists!('unknown:foo')).toBe(false)
  })

  it('unlinking a user definition reindexes the managed fallback when one exists', async () => {
    registerPluginDefinition('workflows', 'shadowed', {
      ...MANAGED_DEF,
      name: 'Managed Shadowed Flow',
      description: 'Fallback managed workflow',
    })

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    await captured.capturedDef!.onUnlink!('workflows/definitions/shadowed.yaml')

    expect(captured.removeCalls).toEqual([])
    expect(captured.indexCalls).toHaveLength(1)
    expect(captured.indexCalls[0]).toMatchObject({
      key: 'def:shadowed',
      doc: {
        name: 'Managed Shadowed Flow',
        type: 'definition',
      },
    })
  })

  it('unlinking one user definition extension keeps the alternate extension indexed', async () => {
    writeFileSync(join(defsDir, 'alternate.yml'), SAMPLE_DEF.replace('Sample Flow', 'Alternate Extension Flow'))

    const captured = makeCtx()
    await workflowsPlugin.activate(captured.ctx)

    await captured.capturedDef!.onUnlink!('workflows/definitions/alternate.yaml')

    expect(captured.removeCalls).toEqual([])
    expect(captured.indexCalls).toHaveLength(1)
    expect(captured.indexCalls[0]).toMatchObject({
      key: 'def:alternate',
      doc: {
        name: 'Alternate Extension Flow',
        type: 'definition',
        status: 'active',
      },
    })
  })
})
