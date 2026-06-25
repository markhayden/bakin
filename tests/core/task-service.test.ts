import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock dependencies before importing
const contentDirMock = {
  getContentDir: mock(() => '/tmp/bakin-test'),
  getBakinPaths: mock(() => ({ home: '/tmp/bakin-test' })),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}
mock.module('@/core/content-dir', () => contentDirMock)
mock.module('../../src/core/content-dir', () => contentDirMock)

mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('@/core/continuation', () => ({
  checkAndContinueDependents: mock(() => Promise.resolve()),
}))

// In-memory completion-gate fake — these unit tests exercise task-service
// orchestration, not ledger semantics (covered by completion-gate.test.ts).
const mockBumpHeartbeatByTask = mock((_taskId: string) => {})
const completionsFake = new Map<string, { taskId: string; runId: string | null; agent: string; channel: string | null; completedAt: number }>()
const ledgerMock = () => ({
  recordCompletion: (taskId: string, input: { runId?: string; agent: string; channel?: string }) => {
    const existing = completionsFake.get(taskId)
    if (existing) return { recorded: false as const, existing }
    completionsFake.set(taskId, { taskId, runId: input.runId ?? null, agent: input.agent, channel: input.channel ?? null, completedAt: Date.now() })
    return { recorded: true as const }
  },
  hasCompletion: (taskId: string) => completionsFake.has(taskId),
  deleteCompletion: (taskId: string) => completionsFake.delete(taskId),
  getLiveRun: () => null,
  bumpHeartbeatByTask: (taskId: string) => mockBumpHeartbeatByTask(taskId),
})
mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../src/core/execution-ledger', ledgerMock)

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockRuntimeAgentsList = mock((...args: unknown[]) => {
  void args
  return Promise.resolve([
    { id: 'main', name: 'Main', status: 'active' },
  ])
})

const mockAppServices = {
  runtime: {
    agents: {
      list: (...args: unknown[]) => mockRuntimeAgentsList(...args),
    },
    messaging: {
      send: (...args: unknown[]) => mockRuntimeSend(...args),
    },
  },
}

mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))

// Mock taskboard functions
const mockAddTaskLog = mock((..._args: unknown[]) => Promise.resolve())
const mockBlockTask = mock((..._args: unknown[]) => Promise.resolve())
const mockCreateTask = mock((..._args: unknown[]) => Promise.resolve({ id: 'new-task-123' }))
const mockMoveTask = mock((..._args: unknown[]) => Promise.resolve())
const mockReadTaskboard = mock((..._args: unknown[]) => ({
  columns: {
    todo: [],
    inProgress: [{ id: 'task-1', title: 'Test Task' }],
    review: [],
    done: [],
    blocked: [],
    archived: [],
  }
}))
const mockSetDependency = mock((..._args: unknown[]) => Promise.resolve())
const mockUpdateTask = mock((..._args: unknown[]) => Promise.resolve())
const mockGetTaskWithColumn = mock((id: string) => {
  if (id !== 'task-1') return null
  return { task: { id: 'task-1', title: 'Test Task' }, column: 'inProgress' }
})

const taskStoreMock = {
  addTaskLog: mockAddTaskLog,
  blockTask: mockBlockTask,
  createTask: mockCreateTask,
  getTasksByColumn: mock(() => []),
  getTaskWithColumn: mockGetTaskWithColumn,
  moveTask: mockMoveTask,
  readTaskboard: mockReadTaskboard,
  setDependency: mockSetDependency,
  updateTask: mockUpdateTask,
}

mock.module('@/core/task-store', () => taskStoreMock)
mock.module('../../src/core/task-store', () => taskStoreMock)

const mockLoadInstance = mock((..._args: unknown[]) => null)
const mockCreateInstance = mock((..._args: unknown[]) => undefined)
const mockCancelWorkflowInstance = mock((..._args: unknown[]) => undefined)

mock.module('@bakin/workflows/lib/runtime', () => ({
  createInstance: (...args: unknown[]) => mockCreateInstance(...args),
  loadInstance: (...args: unknown[]) => mockLoadInstance(...args),
  cancelInstance: (...args: unknown[]) => mockCancelWorkflowInstance(...args),
}))

mock.module('@bakin/workflows/lib/matcher', () => ({
  matchWorkflow: mock(() => null),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => mockHookRegistry,
}))

const mockLoadDefinition = mock((_data: any): Record<string, unknown> | null => ({ name: 'image-social-post', steps: [] }))
const mockListDefinitions = mock((): Array<{ name: string }> => [
  { name: 'image-social-post' },
  { name: 'video-storyboard' },
])

// Mock the hook registry for non-task side effects. Task metadata uses the
// shared task-store mock above, not plugin hooks.
const hookHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'workflows.loadInstance': (data: any) => mockLoadInstance(data),
  'workflows.createInstance': (data: any) => mockCreateInstance(data),
  'workflows.matchWorkflow': () => null,
  'workflows.loadDefinition': (data: any) => mockLoadDefinition(data),
  'workflows.definitions.list': () => mockListDefinitions(),
  'workflows.cancelInstance': (data: any) => mockCancelWorkflowInstance(data),
}

const mockHookRegistry = {
  invoke: mock(async <R>(name: string, data: unknown): Promise<R | undefined> => {
    const handler = hookHandlers[name]
    if (handler) return await handler(data) as R
    return undefined
  }),
  callAll: mock(async () => undefined),
  register: mock(),
  has: mock(() => false),
}

const pluginRegistryMock = {
  getHookRegistry: () => mockHookRegistry,
  getPluginSkills: () => new Map(),
}
mock.module('@/core/plugin-registry', () => pluginRegistryMock)
mock.module('../../src/core/plugin-registry', () => pluginRegistryMock)

describe('task-service', () => {
  let service: typeof import('@/core/task-service')
  let mockBroadcast: ReturnType<typeof mock>

  beforeEach(async () => {
    mock.clearAllMocks()
    completionsFake.clear()
    mockBroadcast = mock()
    ;(globalThis as any).__bakinBroadcast = mockBroadcast
    service = await import('@/core/task-service')
  })

  afterEach(() => {
    delete (globalThis as any).__bakinBroadcast
  })

  describe('logProgress', () => {
    it('should broadcast via SSE and persist log', async () => {
      await service.logProgress('task-1', 'pixel', 'Generating image...')

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'activity',
          agent: 'pixel',
          message: 'Generating image...',
          taskId: 'task-1',
        })
      )
      expect(mockAddTaskLog).toHaveBeenCalledWith('task-1', 'pixel', 'Generating image...')
    })

    it('should broadcast even if no SSE handler registered', async () => {
      delete (globalThis as any).__bakinBroadcast
      await service.logProgress('task-1', 'pixel', 'test')
      expect(mockAddTaskLog).toHaveBeenCalledTimes(1)
    })

    it('bumps the run heartbeat — the watchdog liveness signal', async () => {
      await service.logProgress('task-1', 'pixel', 'still working')
      expect(mockBumpHeartbeatByTask).toHaveBeenCalledWith('task-1')
    })

    it('a heartbeat failure never breaks progress logging (advisory)', async () => {
      mockBumpHeartbeatByTask.mockImplementationOnce(() => {
        throw new Error('ledger hiccup')
      })
      await service.logProgress('task-1', 'pixel', 'still working')
      expect(mockAddTaskLog).toHaveBeenCalledTimes(1)
    })

    it('rejects progress logging when workflow ownership denies it', async () => {
      mockHookRegistry.has.mockReturnValueOnce(true)
      mockHookRegistry.invoke.mockResolvedValueOnce({
        allowed: false,
        reason: 'Agent "pixel" is not the owner of the active workflow step',
      })

      await expect(service.logProgress('task-1', 'pixel', 'test')).rejects.toThrow(/not the owner/)
      expect(mockBroadcast).not.toHaveBeenCalled()
      expect(mockAddTaskLog).not.toHaveBeenCalled()
    })
  })

  describe('moveTaskWithEffects', () => {
    it('should move task and append audit', async () => {
      const { appendAudit } = require('@/core/audit') as typeof import('@/core/audit')
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')

      expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'done', undefined, undefined)
      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.moved',
        'pixel',
        expect.objectContaining({ id: 'task-1', to: 'done' }),
        undefined,
      )
      expect(mockHookRegistry.callAll).toHaveBeenCalledWith(
        'tasks.statusChanged',
        expect.objectContaining({
          taskId: 'task-1',
          to: 'done',
          agent: 'pixel',
          task: expect.objectContaining({ id: 'task-1' }),
        }),
      )
    })

    it('should trigger continuation when moved to done', async () => {
      const { checkAndContinueDependents } = require('@/core/continuation') as typeof import('@/core/continuation')
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')

      expect(checkAndContinueDependents).toHaveBeenCalled()
    })

    it('should not call indexCompletedTask (moved to tasks plugin ctx.search)', async () => {
      // indexCompletedTask removed from task-service — tasks plugin now handles
      // search indexing via ctx.search.index() in its route/tool handlers
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')
      // Just verify no error — the actual indexing test belongs in the plugin tests
    })

    it('should NOT trigger continuation for non-done moves', async () => {
      const { checkAndContinueDependents } = require('@/core/continuation') as typeof import('@/core/continuation')
      await service.moveTaskWithEffects('task-1', 'inProgress', 'pixel')

      expect(checkAndContinueDependents).not.toHaveBeenCalled()
    })

    it('should enforce workflow done-guard', async () => {
      mockReadTaskboard.mockReturnValueOnce({
        columns: {
          todo: [],
          inProgress: [{ id: 'wf-task', title: 'Workflow Task', workflowId: 'image-gen' } as any],
          review: [],
          done: [],
          blocked: [],
          archived: [],
        }
      })
      mockLoadInstance.mockReturnValueOnce({ status: 'in_progress' } as any)

      await expect(
        service.moveTaskWithEffects('wf-task', 'done', 'pixel')
      ).rejects.toThrow('Workflow tasks cannot be moved to Done directly')
    })

    it('should allow done-guard skip via option', async () => {
      await service.moveTaskWithEffects('task-1', 'done', 'pixel', { skipDoneGuard: true })
      expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'done', undefined, undefined)
    })
  })

  describe('blockTaskWithEffects', () => {
    it('should block task and append audit', async () => {
      const { appendAudit } = require('@/core/audit') as typeof import('@/core/audit')
      await service.blockTaskWithEffects('task-1', 'API key expired', 'pixel')

      expect(mockBlockTask).toHaveBeenCalledWith('task-1', 'API key expired', 'pixel', undefined)
      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.blocked',
        'pixel',
        expect.objectContaining({ id: 'task-1', reason: 'API key expired' }),
        undefined,
      )
    })

    it('cancels active workflow instance when blocking a workflow-backed task', async () => {
      mockLoadInstance.mockReturnValueOnce({ status: 'in_progress' } as any)

      await service.blockTaskWithEffects('task-1', 'Image provider unavailable', 'pixel')

      expect(mockCancelWorkflowInstance).toHaveBeenCalledWith({
        taskId: 'task-1',
        reason: 'Task blocked: Image provider unavailable',
        actor: { source: 'agent', id: 'pixel', displayName: 'pixel' },
      })
    })
  })

  describe('createTaskWithEffects', () => {
    it('should create task and return id', async () => {
      const result = await service.createTaskWithEffects({
        title: 'Generate hero image',
        assignee: 'pixel',
        createdBy: 'chef',
      })

      expect(result.id).toBe('new-task-123')
      expect(mockCreateTask).toHaveBeenCalledWith(
        'Generate hero image',
        undefined, // column
        'pixel',   // assignee
        undefined, // description
        undefined, // workflowId
        'chef',   // createdBy
        undefined, // id
        undefined, // parentId
        undefined, // projectId
        {
          availableAt: undefined,
          dueAt: undefined,
          source: undefined,
          scheduleJobId: undefined,
          dependsOn: undefined,
        },
      )
    })

    it('passes scheduling and provenance fields into the task store', async () => {
      await service.createTaskWithEffects({
        title: 'Prep channel deliverable',
        assignee: 'patch',
        createdBy: 'messaging',
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: '2026-05-22T15:00:00.000Z',
        source: {
          pluginId: 'messaging',
          entityType: 'deliverable',
          entityId: 'deliverable-1',
          purpose: 'kickoff',
        },
      })

      expect(mockCreateTask).toHaveBeenCalledWith(
        'Prep channel deliverable',
        undefined,
        'patch',
        undefined,
        undefined,
        'messaging',
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          availableAt: '2026-05-18T15:00:00.000Z',
          dueAt: '2026-05-22T15:00:00.000Z',
          source: {
            pluginId: 'messaging',
            entityType: 'deliverable',
            entityId: 'deliverable-1',
            purpose: 'kickoff',
          },
        }),
      )
    })

    it('should append audit on creation', async () => {
      const { appendAudit } = require('@/core/audit') as typeof import('@/core/audit')
      await service.createTaskWithEffects({ title: 'Test', createdBy: 'cli' })

      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.created',
        'cli',
        expect.objectContaining({ title: 'Test' }),
        undefined,
      )
    })

    it('rejects a workflowId that does not match a known workflow', async () => {
      mockLoadDefinition.mockReturnValueOnce(null)

      await expect(
        service.createTaskWithEffects({
          title: 'Bogus',
          workflowId: 'instagram-post',
          createdBy: 'main',
        })
      ).rejects.toThrow(/Unknown workflow: "instagram-post"/)

      // The task row must NOT be written when the workflow is invalid.
      expect(mockCreateTask).not.toHaveBeenCalled()
    })

    it('lists available workflows in the rejection message', async () => {
      mockLoadDefinition.mockReturnValueOnce(null)

      await expect(
        service.createTaskWithEffects({
          title: 'Bogus',
          workflowId: 'made-up',
          createdBy: 'main',
        })
      ).rejects.toThrow(/image-social-post/)
    })

    it('accepts a workflowId that matches a known workflow', async () => {
      mockLoadDefinition.mockReturnValueOnce({ name: 'image-social-post', steps: [] })

      const result = await service.createTaskWithEffects({
        title: 'Real one',
        workflowId: 'image-social-post',
        createdBy: 'main',
      })

      expect(result.workflowId).toBe('image-social-post')
      expect(mockCreateTask).toHaveBeenCalled()
    })

    it('surfaces workflow start failures after clearing the task workflowId', async () => {
      mockLoadDefinition.mockReturnValueOnce({ name: 'image-social-post', steps: [] })
      mockCreateInstance.mockImplementationOnce(() => {
        throw new Error('unknown agent pixel')
      })

      await expect(service.createTaskWithEffects({
        title: 'Bad owner',
        workflowId: 'image-social-post',
        createdBy: 'main',
      })).rejects.toThrow(/Failed to start workflow "image-social-post": unknown agent pixel/)

      expect(mockUpdateTask).toHaveBeenCalledWith('new-task-123', { workflowId: undefined })
    })

    it('does not call workflows.loadDefinition when no workflowId provided', async () => {
      await service.createTaskWithEffects({ title: 'Plain task', createdBy: 'cli' })
      expect(mockLoadDefinition).not.toHaveBeenCalled()
    })
  })

  describe('reportComplete', () => {
    it('should reject workflow tasks', async () => {
      mockReadTaskboard.mockReturnValueOnce({
        columns: {
          todo: [],
          inProgress: [{ id: 'wf-task', title: 'WF Task', workflowId: 'img-gen' } as any],
          review: [],
          done: [],
          blocked: [],
          archived: [],
        }
      })
      mockLoadInstance.mockReturnValueOnce({ status: 'in_progress' } as any)

      await expect(
        service.reportComplete('wf-task', 'pixel', 'Done with images')
      ).rejects.toThrow('workflow task')
    })

    it('should move to done, log summary, and notify orchestrator', async () => {
      await service.reportComplete('task-1', 'pixel', 'Generated 3 images')

      expect(mockAddTaskLog).toHaveBeenCalledWith(
        'task-1', 'pixel', 'Task complete: Generated 3 images'
      )
      expect(mockMoveTask).toHaveBeenCalled()
      expect(mockRuntimeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'main',
          content: expect.stringContaining('TASK COMPLETE'),
        })
      )
      // Notification sends are conversational — they stay in the agent's
      // default session, never a per-dispatch task session.
      const sendArgs = mockRuntimeSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(sendArgs.threadId).toBeUndefined()
    })
  })

  describe('setDependencyWithEffects', () => {
    it('should set dependency and append audit', async () => {
      const { appendAudit } = require('@/core/audit') as typeof import('@/core/audit')
      await service.setDependencyWithEffects('task-a', 'task-b')

      expect(mockSetDependency).toHaveBeenCalledWith('task-a', 'task-b')
      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.dependency_set',
        'api',
        { id: 'task-a', dependsOn: 'task-b' },
        undefined,
      )
    })
  })

  describe('getTaskDetails', () => {
    it('should find task by id and return with column name', async () => {
      const result = await service.getTaskDetails('task-1')
      expect(result).not.toBeNull()
      expect(result!.column).toBe('inProgress')
      expect(result!.task).toEqual(
        expect.objectContaining({ id: 'task-1', title: 'Test Task' })
      )
    })

    it('should return null for unknown task', async () => {
      expect(await service.getTaskDetails('nonexistent')).toBeNull()
    })
  })
})
