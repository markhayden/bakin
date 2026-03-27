import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock dependencies before importing
vi.mock('@/core/content-dir', () => ({
  getContentDir: vi.fn(() => '/tmp/beacon-test'),
  getBeaconPaths: vi.fn(() => ({ home: '/tmp/beacon-test' })),
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
const mockAddTaskLog = vi.fn(() => Promise.resolve())
const mockBlockTask = vi.fn(() => Promise.resolve())
const mockCreateTask = vi.fn(() => Promise.resolve({ id: 'new-task-123' }))
const mockMoveTask = vi.fn(() => Promise.resolve())
const mockReadTaskboard = vi.fn(() => ({
  columns: {
    todo: [],
    inProgress: [{ id: 'task-1', title: 'Test Task' }],
    review: [],
    done: [],
    blocked: [],
    confirmed: [],
  }
}))
const mockSetDependency = vi.fn(() => Promise.resolve())
const mockUpdateTask = vi.fn(() => Promise.resolve())

vi.mock('@mc/tasks/taskboard', () => ({
  addTaskLog: mockAddTaskLog,
  blockTask: mockBlockTask,
  createTask: mockCreateTask,
  moveTask: mockMoveTask,
  readTaskboard: mockReadTaskboard,
  setDependency: mockSetDependency,
  updateTask: mockUpdateTask,
}))

vi.mock('@mc/workflows/runtime', () => ({
  createInstance: vi.fn(),
  loadInstance: vi.fn(() => null),
}))

vi.mock('@mc/workflows/matcher', () => ({
  matchWorkflow: vi.fn(() => null),
}))

describe('task-service', () => {
  let service: typeof import('@/core/task-service')
  let mockBroadcast: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockBroadcast = vi.fn()
    ;(globalThis as any).__beaconBroadcast = mockBroadcast
    service = await import('@/core/task-service')
  })

  afterEach(() => {
    delete (globalThis as any).__beaconBroadcast
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
      delete (globalThis as any).__beaconBroadcast
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
      const { loadInstance } = await import('@mc/workflows/runtime')
      mockReadTaskboard.mockReturnValueOnce({
        columns: {
          todo: [],
          inProgress: [{ id: 'wf-task', title: 'Workflow Task', workflowId: 'image-gen' } as any],
          review: [],
          done: [],
          blocked: [],
          confirmed: [],
        }
      })
      vi.mocked(loadInstance).mockReturnValueOnce({ status: 'in_progress' } as any)

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
      const { loadInstance } = await import('@mc/workflows/runtime')
      mockReadTaskboard.mockReturnValueOnce({
        columns: {
          todo: [],
          inProgress: [{ id: 'wf-task', title: 'WF Task', workflowId: 'img-gen' } as any],
          review: [],
          done: [],
          blocked: [],
          confirmed: [],
        }
      })
      vi.mocked(loadInstance).mockReturnValueOnce({ status: 'in_progress' } as any)

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
    it('should find task by id and return with column name', () => {
      const result = service.getTaskDetails('task-1')
      expect(result).not.toBeNull()
      expect(result!.column).toBe('inProgress')
      expect(result!.task).toEqual(
        expect.objectContaining({ id: 'task-1', title: 'Test Task' })
      )
    })

    it('should return null for unknown task', () => {
      expect(service.getTaskDetails('nonexistent')).toBeNull()
    })
  })
})
