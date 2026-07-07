/**
 * Tests for tasks plugin MCP exec tools (plugins/tasks/lib/exec-tools.ts —
 * all bakin_exec_tasks_* tools).
 * Split from routes.test.ts (FW7); shared mock scaffold lives in
 * helpers/tasks-routes-harness.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  activatePlugin,
  findTool,
  callTool,
  type ActivatedPlugin,
} from '../test-helpers'
import {
  ledgerMock,
  taskStoreMock,
  taskServiceMock,
  resetTasksRoutesHarness,
  mockLiveRuns,
  mockReadTaskboard,
  mockMoveTaskWithEffects,
  mockBlockTaskWithEffects,
  mockCreateTaskWithEffects,
  mockReportComplete,
  mockSetDependencyWithEffects,
  mockGetTaskDetails,
  mockLogProgress,
  mockTriggerDispatch,
  mockUpdateTask,
} from './helpers/tasks-routes-harness'

// ─── Mocks ─────────────────────────────────────────────────────────────────
// (mock.module stays per-file — FW1.8 dual mocks on every split surface;
// the shared mock functions and module factories live in the harness helper)

const testDir = join(process.cwd(), 'test-content-tasks-exec-tools')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    tasks: join(testDir, 'tasks'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    tasks: join(testDir, 'tasks'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/lib/content-files', () => ({
  readContentFile: mock(() => null),
  writeContentFile: mock(),
}))

mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../../src/core/execution-ledger', ledgerMock)

mock.module('../../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: mock(),
}))

// Both specifiers — runs-reader imports task-store relatively (same trap as the ledger mock).
mock.module('@/core/task-store', taskStoreMock)
mock.module('../../../src/core/task-store', taskStoreMock)

mock.module('../../../src/core/task-service', taskServiceMock)

// ─── Setup ─────────────────────────────────────────────────────────────────

let activated: ActivatedPlugin

beforeAll(async () => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }
  const plugin = (await import('../../../plugins/tasks')).default
  activated = await activatePlugin(plugin, testDir)
})

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true })
  }
})

beforeEach(() => {
  mock.clearAllMocks()
  resetTasksRoutesHarness()
})

// ═══════════════════════════════════════════════════════════════════════════
// Exec Tools
// ═══════════════════════════════════════════════════════════════════════════

describe('Tasks Plugin — Exec Tool Registration', () => {
  it('registers 11 exec tools', () => {
    expect(activated.execTools.length).toBe(11)
  })

  it.each([
    'bakin_exec_tasks_list',
    'bakin_exec_tasks_get',
    'bakin_exec_tasks_create',
    'bakin_exec_tasks_move',
    'bakin_exec_tasks_block',
    'bakin_exec_tasks_complete',
    'bakin_exec_tasks_log_progress',
    'bakin_exec_tasks_set_dependency',
  ])('registers %s', (name) => {
    expect(findTool(activated.execTools, name)).toBeDefined()
  })
})

// ─── bakin_exec_tasks_list ─────────────────────────────────────────────────

describe('bakin_exec_tasks_list', () => {
  it('returns the full board when no filters are provided', async () => {
    const board = { columns: { todo: [{ id: 't1' }], done: [{ id: 't2' }] } }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(result.columns).toEqual(board.columns)
  })

  it('filters by column', async () => {
    const board = {
      columns: {
        todo: [{ id: 't1', agent: 'pixel' }],
        done: [{ id: 't2', agent: 'rolo' }],
      },
    }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, { column: 'todo' })

    expect(result.ok).toBe(true)
    expect((result.columns as Record<string, unknown[]>).todo).toHaveLength(1)
    expect((result.columns as Record<string, unknown[]>).done).toBeUndefined()
  })

  it('filters by agent', async () => {
    const board = {
      columns: {
        todo: [{ id: 't1', agent: 'pixel' }, { id: 't2', agent: 'rolo' }],
      },
    }
    mockReadTaskboard.mockResolvedValue(board)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, { agent: 'pixel' })

    expect(result.ok).toBe(true)
    const cols = result.columns as Record<string, Array<{ agent: string }>>
    expect(cols.todo).toHaveLength(1)
    expect(cols.todo[0].agent).toBe('pixel')
  })

  it('returns error when taskboard is null', async () => {
    mockReadTaskboard.mockResolvedValue(null)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_list')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Failed to read')
  })
})

// ─── bakin_exec_tasks_get ──────────────────────────────────────────────────

describe('bakin_exec_tasks_get', () => {
  it('returns task details', async () => {
    const details = { task: { id: 'abc', title: 'Test' }, column: 'inProgress' }
    mockGetTaskDetails.mockResolvedValue(details)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    expect(result.ok).toBe(true)
    expect(result.task).toEqual(details.task)
  })

  it('returns error when task not found', async () => {
    mockGetTaskDetails.mockResolvedValue(null)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'missing' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('enriches with project context when projectId is present', async () => {
    const details = { task: { id: 'abc', projectId: 'proj-1' }, column: 'todo' }
    mockGetTaskDetails.mockResolvedValue(details)
    const mockHooksCall = activated.ctx.hooks.call as ReturnType<typeof mock>
    mockHooksCall.mockImplementationOnce(async (_name: string, data: Record<string, unknown>) => ({
      ...data,
      projectTitle: 'Project X',
      projectStatus: 'active',
      projectProgress: 50,
      projectExcerpt: 'This is the project body content for testing purposes.',
    })
    )

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    expect(result.ok).toBe(true)
    expect(mockHooksCall).toHaveBeenCalledWith('tasks.enrichDetails', details)
    expect(result.projectTitle).toBe('Project X')
    expect(result.projectStatus).toBe('active')
    expect(result.projectProgress).toBe(50)
  })

  it('gracefully handles missing project plugin', async () => {
    const details = { task: { id: 'abc', projectId: 'proj-1' }, column: 'todo' }
    mockGetTaskDetails.mockResolvedValue(details)
    const mockHooksCall = activated.ctx.hooks.call as ReturnType<typeof mock>
    mockHooksCall.mockRejectedValueOnce(new Error('Hook not found'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    // Should still succeed, just without project data
    expect(result.ok).toBe(true)
    expect(result.projectTitle).toBeUndefined()
  })
})

describe('bakin_exec_tasks_get liveRun visibility', () => {
  it('includes the live run while one is in flight, so duplicate sessions can self-detect', async () => {
    mockGetTaskDetails.mockResolvedValue({ task: { id: 'd1b213a5', title: 'Cat image' }, column: 'inProgress' })
    mockLiveRuns['d1b213a5'] = { runId: 'task:d1b213a5:d1', agent: 'pixel', startedAt: 1781063794175 }

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'd1b213a5' })

    expect(result.ok).toBe(true)
    expect(result.liveRun).toEqual({
      runId: 'task:d1b213a5:d1',
      agent: 'pixel',
      startedAt: new Date(1781063794175).toISOString(),
    })
  })

  it('returns liveRun null when no run is in flight', async () => {
    mockGetTaskDetails.mockResolvedValue({ task: { id: 'abc', title: 'Done thing' }, column: 'done' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_get')!
    const result = await callTool(tool, { taskId: 'abc' })

    expect(result.ok).toBe(true)
    expect(result.liveRun).toBeNull()
  })
})

// ─── bakin_exec_tasks_create ───────────────────────────────────────────────

describe('bakin_exec_tasks_create', () => {
  it('tells the creator that dispatch notifies the assignee — no separate message needed', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t', workflowId: 'wf-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'New Task', assignee: 'pixel', workflowId: 'wf-1' }, 'main')

    expect(result.ok).toBe(true)
    expect(result.notice).toContain('dispatch will notify pixel')
    expect(result.notice).toContain('do NOT send them a separate message')
  })

  it('omits the dispatch copy when nothing was dispatched', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t3', workflowId: 'wf-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'Unassigned Task', workflowId: 'wf-1' }, 'main')

    expect(result.ok).toBe(true)
    expect(result.notice ?? '').not.toContain('separate message')
  })

  it('creates a team-assigned task and triggers dispatch (#189)', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'team-t' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'Team task', team: 'development', skipWorkflowReason: 'n/a' }, 'main')

    expect(result.ok).toBe(true)
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({ team: 'development' })
    )
    expect(mockTriggerDispatch).toHaveBeenCalled()
  })

  it('surfaces createTaskWithEffects team validation errors (#189)', async () => {
    mockCreateTaskWithEffects.mockRejectedValue(new Error('Unknown team: "ghost-team"'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'Bad', team: 'ghost-team', skipWorkflowReason: 'n/a' }, 'main')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown team')
  })

  it('creates a task with workflow', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t', workflowId: 'wf-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'New Task',
      assignee: 'pixel',
      workflowId: 'wf-1',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.id).toBe('new-t')
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Task',
        assignee: 'pixel',
        workflowId: 'wf-1',
        createdBy: 'chef',
        channel: 'mcp',
      })
    )
  })

  it('bakin_exec_tasks_update re-assigns to a team (#189)', async () => {
    mockUpdateTask.mockResolvedValue(undefined)
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_update')!
    const result = await callTool(tool, { taskId: 'task-1', team: 'development' }, 'main')
    expect(result.ok).toBe(true)
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ team: 'development' }))
  })

  it('bakin_exec_tasks_update rejects agent + team together (#189)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_update')!
    const result = await callTool(tool, { taskId: 'task-1', agent: 'pixel', team: 'development' }, 'main')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('both')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('bakin_exec_tasks_update rejects an unknown team (#189)', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_update')!
    const result = await callTool(tool, { taskId: 'task-1', team: 'ghost-team' }, 'main')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown team')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('creates a scheduled source-linked task from MCP parameters', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'scheduled-mcp' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Scheduled channel kickoff',
      availableAt: '2026-05-18T15:00:00.000Z',
      dueAt: '2026-05-22T15:00:00.000Z',
      sourcePluginId: 'messaging',
      sourceEntityType: 'deliverable',
      sourceEntityId: 'deliverable-1',
      sourcePurpose: 'kickoff',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(mockCreateTaskWithEffects).toHaveBeenCalledWith(
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

  it('creates a task with skipWorkflowReason', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'new-t2' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Simple Task',
      skipWorkflowReason: 'One-off cleanup',
    }, 'chef')

    expect(result.ok).toBe(true)
  })

  it('creates a subtask without workflow requirement', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'sub-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Subtask',
      parentId: 'parent-1',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.id).toBe('sub-1')
  })

  it('succeeds without workflowId but includes notice when no workflow matched', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'no-wf-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, { title: 'Bad Task' }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.notice).toContain('No workflow attached')
  })

  it('nudges toward checklist structure when the description enumerates several deliverables', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'multi-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Competitive research',
      parentId: 'parent-1',
      description: 'Produce:\n1. Executive brief\n2. Technical report\n3. Comparison matrix\n4. Recommendation memo',
    }, 'chef')

    expect(result.ok).toBe(true)
    expect(result.notice).toContain('markdown checklist')
    expect(result.notice).toContain('one in succession')
  })

  it('nudge boundary: 2 enumerated items stay silent, 3 fire — across marker styles', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'bound-1' })
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!

    const two = await callTool(tool, {
      title: 'Two items',
      parentId: 'parent-1',
      description: 'Deliver:\n- brief\n- report',
    }, 'chef')
    expect(two.notice ?? '').not.toContain('markdown checklist')

    const threeMixed = await callTool(tool, {
      title: 'Three items, mixed markers',
      parentId: 'parent-1',
      description: 'Deliver:\n• brief\n* report\n1) matrix',
    }, 'chef')
    expect(threeMixed.notice).toContain('markdown checklist')
  })

  it('does NOT nudge for checklist-formatted or short descriptions (advisory only, never rejects)', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'ok-1' })
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!

    const checklisted = await callTool(tool, {
      title: 'Research',
      parentId: 'parent-1',
      description: '- [ ] brief\n- [ ] report\n- [ ] matrix\n- [ ] memo',
    }, 'chef')
    expect(checklisted.ok).toBe(true)
    expect(checklisted.notice ?? '').not.toContain('markdown checklist')

    const short = await callTool(tool, {
      title: 'Small task',
      parentId: 'parent-1',
      description: 'Just one deliverable:\n- the report',
    }, 'chef')
    expect(short.ok).toBe(true)
    expect(short.notice ?? '').not.toContain('markdown checklist')
  })

  it('triggers dispatch when assignee is provided', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'disp-1' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Dispatched Task',
      assignee: 'pixel',
      workflowId: 'wf-1',
    }, 'chef')

    expect(mockTriggerDispatch).toHaveBeenCalled()
  })

  it('triggers dispatch when parentId is provided', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'disp-2' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Child Task',
      parentId: 'parent-1',
    }, 'chef')

    expect(mockTriggerDispatch).toHaveBeenCalled()
  })

  it('does not trigger dispatch for unassigned top-level tasks', async () => {
    mockCreateTaskWithEffects.mockResolvedValue({ id: 'no-disp' })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    await callTool(tool, {
      title: 'Unassigned',
      workflowId: 'wf-1',
    }, 'chef')

    expect(mockTriggerDispatch).not.toHaveBeenCalled()
  })

  it('returns error on creation failure', async () => {
    mockCreateTaskWithEffects.mockRejectedValue(new Error('boom'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_create')!
    const result = await callTool(tool, {
      title: 'Fail',
      workflowId: 'wf-1',
    }, 'chef')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })
})

// ─── bakin_exec_tasks_move ─────────────────────────────────────────────────

describe('bakin_exec_tasks_move', () => {
  it('moves a task to a new column', async () => {
    mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'review' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockMoveTaskWithEffects).toHaveBeenCalledWith('task-m', 'review', 'pixel', { channel: 'mcp' })
  })

  it('requires reason when moving to blocked', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'blocked' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('reason is required')
  })

  it('returns error on move failure', async () => {
    mockMoveTaskWithEffects.mockRejectedValue(new Error('invalid transition'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_move')!
    const result = await callTool(tool, { taskId: 'task-m', to: 'done' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid transition')
  })
})

// ─── bakin_exec_tasks_block ────────────────────────────────────────────────

describe('bakin_exec_tasks_block', () => {
  it('blocks a task', async () => {
    mockBlockTaskWithEffects.mockResolvedValue({ alreadyComplete: false })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 'task-b', reason: 'need API key' }, 'trainer')

    expect(result.ok).toBe(true)
    expect(mockBlockTaskWithEffects).toHaveBeenCalledWith('task-b', 'need API key', 'trainer', 'mcp')
  })

  it('returns error on block failure', async () => {
    mockBlockTaskWithEffects.mockRejectedValue(new Error('block err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_block')!
    const result = await callTool(tool, { taskId: 'task-b', reason: 'fail' }, 'trainer')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('block err')
  })
})

// ─── bakin_exec_tasks_complete ─────────────────────────────────────────────

describe('bakin_exec_tasks_complete', () => {
  it('completes a task', async () => {
    mockReportComplete.mockResolvedValue({ alreadyComplete: false })

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_complete')!
    const result = await callTool(tool, { taskId: 'task-c', summary: 'All done' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockReportComplete).toHaveBeenCalledWith('task-c', 'pixel', 'All done', 'mcp')
  })

  it('returns error on completion failure', async () => {
    mockReportComplete.mockRejectedValue(new Error('complete err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_complete')!
    const result = await callTool(tool, { taskId: 'task-c', summary: 'fail' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('complete err')
  })
})

// ─── bakin_exec_tasks_log_progress ─────────────────────────────────────────

describe('bakin_exec_tasks_log_progress', () => {
  it('logs a progress update', async () => {
    mockLogProgress.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_log_progress')!
    const result = await callTool(tool, { taskId: 'task-lp', message: 'Step 3 done' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(mockLogProgress).toHaveBeenCalledWith('task-lp', 'pixel', 'Step 3 done', 'mcp')
  })

  it('returns error on log failure', async () => {
    mockLogProgress.mockRejectedValue(new Error('log err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_log_progress')!
    const result = await callTool(tool, { taskId: 'task-lp', message: 'fail' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('log err')
  })
})

// ─── bakin_exec_tasks_set_dependency ───────────────────────────────────────

describe('bakin_exec_tasks_set_dependency', () => {
  it('sets a dependency', async () => {
    mockSetDependencyWithEffects.mockResolvedValue(undefined)

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_set_dependency')!
    const result = await callTool(tool, { taskId: 'task-sd', dependsOn: 'task-other' }, 'rolo')

    expect(result.ok).toBe(true)
    expect(result.message).toContain('Dependency registered')
    expect(mockSetDependencyWithEffects).toHaveBeenCalledWith('task-sd', 'task-other', 'mcp')
  })

  it('returns error on dependency failure', async () => {
    mockSetDependencyWithEffects.mockRejectedValue(new Error('dep err'))

    const tool = findTool(activated.execTools, 'bakin_exec_tasks_set_dependency')!
    const result = await callTool(tool, { taskId: 'task-sd', dependsOn: 'task-other' }, 'rolo')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('dep err')
  })
})
