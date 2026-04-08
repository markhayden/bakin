import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock dependencies before importing
vi.mock('@/core/content-dir', () => ({
  getContentDir: vi.fn(() => '/tmp/bakin-test'),
  getBakinPaths: vi.fn(() => ({ home: '/tmp/bakin-test' })),
}))

vi.mock('@/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('@/core/antfly', () => ({
  indexCompletedTask: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/core/continuation', () => ({
  checkAndContinueDependents: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/core/openclaw-client', () => ({
  sendMessage: vi.fn(() => Promise.resolve('')),
}))

// Mock taskboard functions
const mockAddTaskLog = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockBlockTask = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockCreateTask = vi.fn((..._args: unknown[]) => Promise.resolve({ id: 'new-task-123' }))
const mockMoveTask = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockReadTaskboard = vi.fn((..._args: unknown[]) => ({
  columns: {
    todo: [],
    inProgress: [{ id: 'task-1', title: 'Test Task' }],
    review: [],
    done: [],
    blocked: [],
    archived: [],
  }
}))
const mockSetDependency = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockUpdateTask = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('@bakin/tasks/lib/taskboard', () => ({
  addTaskLog: mockAddTaskLog,
  blockTask: mockBlockTask,
  createTask: mockCreateTask,
  moveTask: mockMoveTask,
  readTaskboard: mockReadTaskboard,
  setDependency: mockSetDependency,
  updateTask: mockUpdateTask,
}))

const mockLoadInstance = vi.fn((..._args: unknown[]) => null)
const mockCreateInstance = vi.fn((..._args: unknown[]) => undefined)

vi.mock('@bakin/workflows/lib/runtime', () => ({
  createInstance: (...args: unknown[]) => mockCreateInstance(...args),
  loadInstance: (...args: unknown[]) => mockLoadInstance(...args),
}))

vi.mock('@bakin/workflows/lib/matcher', () => ({
  matchWorkflow: vi.fn(() => null),
}))

// Mock the hook registry so that hooks().invoke() routes to the right mock functions
const hookHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'tasks.readTaskboard': () => mockReadTaskboard(),
  'tasks.addTaskLog': (data: any) => mockAddTaskLog(data.identifier, data.author, data.message),
  'tasks.blockTask': (data: any) => mockBlockTask(data.identifier, data.reason, data.agent),
  'tasks.createTask': (data: any) => mockCreateTask(data.title, data.column, data.assignee, data.description, data.workflowId, data.createdBy, data.id, data.parentId, data.projectId),
  'tasks.moveTask': (data: any) => mockMoveTask(data.identifier, data.to, data.from),
  'tasks.setDependency': (data: any) => mockSetDependency(data.taskId, data.dependsOnId),
  'tasks.updateTask': (data: any) => mockUpdateTask(data.identifier, data.updates),
  'workflows.loadInstance': (data: any) => mockLoadInstance(data),
  'workflows.createInstance': (data: any) => mockCreateInstance(data),
  'workflows.matchWorkflow': () => null,
  'projects.autoCheckLinkedItem': () => Promise.resolve(),
}

const mockHookRegistry = {
  invoke: vi.fn(async <R>(name: string, data: unknown): Promise<R | undefined> => {
    const handler = hookHandlers[name]
    if (handler) return await handler(data) as R
    return undefined
  }),
  register: vi.fn(),
  has: vi.fn(() => false),
}

vi.mock('@/lib/plugin-registry', () => ({
  getHookRegistry: () => mockHookRegistry,
}))

describe('task-service', () => {
  let service: typeof import('@/core/task-service')
  let mockBroadcast: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockBroadcast = vi.fn()
    ;(globalThis as any).__bakinBroadcast = mockBroadcast
    service = await import('@/core/task-service')
  })

  afterEach(() => {
    delete (globalThis as any).__bakinBroadcast
  })

  describe('logProgress', () => {
    it('should broadcast via SSE and persist log', async () => {
      await service.logProgress('task-1', 'pixel', 'Generating image...')

      expect(mockBroadcast).toHaveBeenCalledOnce()
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
      expect(mockAddTaskLog).toHaveBeenCalledOnce()
    })
  })

  describe('moveTaskWithEffects', () => {
    it('should move task and append audit', async () => {
      const { appendAudit } = await import('@/core/audit')
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')

      expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'done', undefined)
      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.moved',
        'pixel',
        expect.objectContaining({ id: 'task-1', to: 'done' }),
        undefined,
      )
    })

    it('should trigger continuation when moved to done', async () => {
      const { checkAndContinueDependents } = await import('@/core/continuation')
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')

      expect(checkAndContinueDependents).toHaveBeenCalled()
    })

    it('should index completed task when moved to done', async () => {
      const { indexCompletedTask } = await import('@/core/antfly')
      await service.moveTaskWithEffects('task-1', 'done', 'pixel')

      expect(indexCompletedTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task-1' })
      )
    })

    it('should NOT trigger continuation for non-done moves', async () => {
      const { checkAndContinueDependents } = await import('@/core/continuation')
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
      expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'done', undefined)
    })
  })

  describe('blockTaskWithEffects', () => {
    it('should block task and append audit', async () => {
      const { appendAudit } = await import('@/core/audit')
      await service.blockTaskWithEffects('task-1', 'API key expired', 'pixel')

      expect(mockBlockTask).toHaveBeenCalledWith('task-1', 'API key expired', 'pixel')
      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.blocked',
        'pixel',
        expect.objectContaining({ id: 'task-1', reason: 'API key expired' }),
        undefined,
      )
    })
  })

  describe('createTaskWithEffects', () => {
    it('should create task and return id', async () => {
      const result = await service.createTaskWithEffects({
        title: 'Generate hero image',
        assignee: 'pixel',
        createdBy: 'basil',
      })

      expect(result.id).toBe('new-task-123')
      expect(mockCreateTask).toHaveBeenCalledWith(
        'Generate hero image',
        undefined, // column
        'pixel',   // assignee
        undefined, // description
        undefined, // workflowId
        'basil',   // createdBy
        undefined, // id
        undefined, // parentId
        undefined, // projectId
      )
    })

    it('should append audit on creation', async () => {
      const { appendAudit } = await import('@/core/audit')
      await service.createTaskWithEffects({ title: 'Test', createdBy: 'cli' })

      expect(appendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'task.created',
        'cli',
        expect.objectContaining({ title: 'Test' }),
        undefined,
      )
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
      const openclaw = await import('@/core/openclaw-client')

      await service.reportComplete('task-1', 'pixel', 'Generated 3 images')

      expect(mockAddTaskLog).toHaveBeenCalledWith(
        'task-1', 'pixel', 'Task complete: Generated 3 images'
      )
      expect(mockMoveTask).toHaveBeenCalled()
      expect(openclaw.sendMessage).toHaveBeenCalledWith(
        'main',
        expect.stringContaining('TASK COMPLETE')
      )
    })
  })

  describe('setDependencyWithEffects', () => {
    it('should set dependency and append audit', async () => {
      const { appendAudit } = await import('@/core/audit')
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
