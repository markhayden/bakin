import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

const testDir = join(tmpdir(), `bakin-test-workflow-gate-hooks-${Date.now()}`)
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

type HookTask = { id: string; title: string; column: string; description?: string }
const hookTasks = new Map<string, HookTask>()
const taskStoreMock = {
  createTask: mock((title: string, column?: string, _assignee?: string, description?: string, _workflowId?: string, _createdBy?: string, id?: string) => {
    const taskId = id ?? `task-${hookTasks.size + 1}`
    const task = { id: taskId, title, column: column ?? 'todo', description }
    hookTasks.set(taskId, task)
    return Promise.resolve(task)
  }),
  addTaskLog: mock(() => Promise.resolve()),
  moveTask: mock((identifier: string, to: string) => {
    const task = hookTasks.get(identifier)
    if (task) task.column = to
    return Promise.resolve()
  }),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock((id: string) => hookTasks.get(id) ?? null),
  getTaskWithColumn: mock(() => null),
  updateTask: mock(() => Promise.resolve()),
}

mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

import workflowsPlugin from '../../../plugins/workflows'
import {
  completeStep,
  createInstance,
  loadInstance,
} from '@bakin/workflows/lib/runtime'

const gateWorkflow = `name: Gate Hook Test
description: Workflow used by gate hook tests
version: 1
steps:
  - id: draft
    type: agent
    label: Draft
    agent: chef
    description: Draft the content.
  - id: review
    type: gate
    label: Review
    description: Human review.
    approval_required: true
    on_reject:
      goto: draft
      note_to_agent: true
  - id: publish
    type: agent
    label: Publish
    agent: main
    description: Publish it.
`

type HookHandler = (data: Record<string, unknown>) => unknown

function makeCtx() {
  const hooks = new Map<string, HookHandler>()
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
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
    },
    hooks: {
      register: mock((name: string, handler: HookHandler) => {
        hooks.set(name, handler)
        return () => hooks.delete(name)
      }),
      call: mock(async (_name, data) => data),
      callAll: mock(async () => undefined),
      has: mock((name: string) => hooks.has(name)),
      invoke: mock(async <R>(name: string, data: unknown): Promise<R | undefined> => {
        return hooks.get(name)?.(data as Record<string, unknown>) as R | undefined
      }) as PluginContext['hooks']['invoke'],
    },
  }

  return { ctx, hooks }
}

async function activateWithHooks() {
  const captured = makeCtx()
  await workflowsPlugin.activate(captured.ctx)
  return captured.hooks
}

function createPendingGate(taskId: string) {
  createInstance(taskId, 'gate-hook-test', testDir)
  const result = completeStep(taskId, 'draft', { caption: 'ready' }, undefined, testDir)
  expect(result.success).toBe(true)
  expect(loadInstance(taskId, testDir)!.stepStates.review.status).toBe('pending_approval')
}

describe('workflows gate hooks', () => {
  beforeEach(() => {
    mock.clearAllMocks()
    hookTasks.clear()
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })
    writeFileSync(join(defsDir, 'gate-hook-test.yaml'), gateWorkflow)
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('registers approveGate and rejectGate hooks', async () => {
    const hooks = await activateWithHooks()
    expect(hooks.has('workflows.approveGate')).toBe(true)
    expect(hooks.has('workflows.rejectGate')).toBe(true)
    expect(hooks.has('workflows.reopenFromStep')).toBe(true)
  })

  it('workflows.approveGate resolves a pending gate and returns approveGate result shape', async () => {
    const hooks = await activateWithHooks()
    createPendingGate('task-approve-hook')

    const result = await hooks.get('workflows.approveGate')!({
      taskId: 'task-approve-hook',
      stepId: 'review',
      contentDir: testDir,
      approver: { id: 'mark', source: 'web' },
    }) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect(result.decision).toMatchObject({ gateLabel: 'Review', approver: { id: 'mark', source: 'web' } })
    const instance = loadInstance('task-approve-hook', testDir)!
    expect(instance.currentStepId).toBe('publish')
    expect(instance.status).toBe('in_progress')
  })

  it('workflows.rejectGate rejects a pending gate and returns rejectGate result shape', async () => {
    const hooks = await activateWithHooks()
    createPendingGate('task-reject-hook')

    const result = await hooks.get('workflows.rejectGate')!({
      taskId: 'task-reject-hook',
      stepId: 'review',
      reason: 'Needs a tighter CTA',
      contentDir: testDir,
      approver: { id: 'mark', source: 'web' },
    }) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect(result.rewoundTo).toBe('draft')
    expect(result.decision).toMatchObject({ gateLabel: 'Review', reason: 'Needs a tighter CTA' })
    const instance = loadInstance('task-reject-hook', testDir)!
    expect(instance.currentStepId).toBe('draft')
    expect(instance.stepStates.draft.status).toBe('in_progress')
  })

  it('gate hooks return clean errors for unknown task or step ids', async () => {
    const hooks = await activateWithHooks()
    createPendingGate('task-error-hook')

    const missingTask = await hooks.get('workflows.approveGate')!({
      taskId: 'missing-task',
      stepId: 'review',
      contentDir: testDir,
    }) as Record<string, unknown>
    expect(missingTask.success).toBe(false)
    expect(missingTask.errors).toEqual(['Workflow instance not found'])

    const missingStep = await hooks.get('workflows.rejectGate')!({
      taskId: 'task-error-hook',
      stepId: 'missing-step',
      reason: 'Nope',
      contentDir: testDir,
    }) as Record<string, unknown>
    expect(missingStep.success).toBe(false)
    expect((missingStep.errors as string[])[0]).toContain('not a gate')
  })

  it('workflows.createInstance routes through the unified recursive start validator (#510)', async () => {
    // #510 dedup: REST, the createInstance hook, and the start exec tool now
    // share ONE strong recursive validator. Proven here on the hook path by
    // rejecting a nested-workflow cycle (parity with the REST cycle test in
    // routes.test.ts) — cycle detection is agent-independent, so it isolates
    // the wiring rather than the empty-mock agent set.
    writeFileSync(join(defsDir, 'cycle-a.yaml'), `name: Cycle A
description: A
version: 1
steps:
  - id: nest-b
    type: workflow
    label: Run B
    workflow_id: cycle-b
`)
    writeFileSync(join(defsDir, 'cycle-b.yaml'), `name: Cycle B
description: B
version: 1
steps:
  - id: nest-a
    type: workflow
    label: Run A
    workflow_id: cycle-a
`)
    const hooks = await activateWithHooks()
    await expect(
      hooks.get('workflows.createInstance')!({
        taskId: 'task-cycle-hook',
        workflowId: 'cycle-a',
        contentDir: testDir,
      }),
    ).rejects.toThrow('cycle detected')
  })

  it('start validation detects cycles through map_workflow child references', async () => {
    writeFileSync(join(defsDir, 'map-cycle-a.yaml'), `name: Map Cycle A
description: A
version: 1
steps:
  - id: seg
    type: agent
    label: Segment
    agent: $assigned
  - id: fan
    type: map_workflow
    label: Fan
    source: seg.items
    workflow_id: map-cycle-b
`)
    writeFileSync(join(defsDir, 'map-cycle-b.yaml'), `name: Map Cycle B
description: B
version: 1
steps:
  - id: nest-a
    type: workflow
    label: Run A
    workflow_id: map-cycle-a
`)
    const hooks = await activateWithHooks()
    await expect(
      hooks.get('workflows.createInstance')!({
        taskId: 'task-map-cycle-hook',
        workflowId: 'map-cycle-a',
        contentDir: testDir,
      }),
    ).rejects.toThrow('cycle detected')
  })

  it('workflows.reopenFromStep reopens the same workflow instance', async () => {
    const hooks = await activateWithHooks()
    createPendingGate('task-reopen-hook')
    await hooks.get('workflows.approveGate')!({
      taskId: 'task-reopen-hook',
      stepId: 'review',
      contentDir: testDir,
      approver: { id: 'mark', source: 'web' },
    })

    const result = await hooks.get('workflows.reopenFromStep')!({
      taskId: 'task-reopen-hook',
      stepId: 'review',
      reason: 'Messaging recovery requested',
      contentDir: testDir,
      actor: { id: 'mark', source: 'web' },
    }) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect(result.reopenedStepId).toBe('draft')
    const instance = loadInstance('task-reopen-hook', testDir)!
    expect(instance.status).toBe('in_progress')
    expect(instance.currentStepId).toBe('draft')
    expect(instance.stepStates.draft.status).toBe('in_progress')
  })
})
