import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { activatePlugin, callTool, findTool, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-workflows-exec-tools-${Date.now()}`)
const definitionsDir = join(testDir, 'workflows', 'definitions')
const originalFetch = globalThis.fetch

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

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
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
    columns: {
      backlog: [],
      inProgress: [...hookTasks.values()].filter(task => task.column === 'inProgress'),
      todo: [...hookTasks.values()].filter(task => task.column === 'todo'),
      review: [...hookTasks.values()].filter(task => task.column === 'review'),
      done: [],
      archived: [],
      blocked: [],
    },
  })),
  getTask: mock((id: string) => hookTasks.get(id) ?? null),
  getTaskWithColumn: mock((id: string) => {
    const task = hookTasks.get(id)
    return task ? { task, column: task.column } : null
  }),
}

mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

import workflowsPlugin from '../../../plugins/workflows'
import { createInstance } from '@bakin/workflows/lib/runtime'

const gateWorkflow = `name: Gate Exec Tool Test
description: Workflow used by exec tool tests
version: 1
steps:
  - id: draft
    type: agent
    label: Draft
    agent: chef
    description: Write the draft
  - id: review
    type: gate
    label: Review final post
    description: Human review
    approval_required: true
    on_approve: done
    on_reject:
      goto: draft
      note_to_agent: true
`

let activated: ActivatedPlugin

beforeAll(async () => {
  globalThis.fetch = mock(async () => new Response('{}')) as unknown as typeof fetch
  mkdirSync(definitionsDir, { recursive: true })
  writeFileSync(join(definitionsDir, 'gate-exec.yaml'), gateWorkflow)
  activated = await activatePlugin(workflowsPlugin, testDir)
})

beforeEach(() => {
  hookTasks.clear()
  taskStoreMock.createTask.mockClear()
  taskStoreMock.addTaskLog.mockClear()
  taskStoreMock.moveTask.mockClear()
  taskStoreMock.getTask.mockClear()
  taskStoreMock.getTaskWithColumn.mockClear()
})

afterAll(() => {
  globalThis.fetch = originalFetch
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
})

describe('workflow exec tools', () => {
  it('returns a waiting gate state instead of failing when an agent asks for the current step', async () => {
    createInstance('task-gate-tool', 'gate-exec', testDir, 'chef')
    const submit = findTool(activated.execTools, 'bakin_exec_submit_step')!
    await callTool(submit, {
      taskId: 'task-gate-tool',
      stepId: 'draft',
      output: { text: 'done' },
    }, 'chef')

    const getStep = findTool(activated.execTools, 'bakin_exec_get_step')!
    const result = await callTool(getStep, { taskId: 'task-gate-tool' }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.raw).toMatchObject({
      status: 'pending_approval',
      stepId: 'review',
    })
    expect(result.formatted).toContain('WAITING FOR HUMAN APPROVAL')
    expect(result.formatted).not.toContain('first step')
  })

  it('returns nextStep when submitting a step reaches a gate', async () => {
    createInstance('task-submit-next-gate', 'gate-exec', testDir, 'chef')
    const submit = findTool(activated.execTools, 'bakin_exec_submit_step')!

    const result = await callTool(submit, {
      taskId: 'task-submit-next-gate',
      stepId: 'draft',
      output: { text: 'done' },
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.nextStep).toMatchObject({
      status: 'pending_approval',
      stepId: 'review',
    })
  })
})
