/**
 * Shared harness for the tasks plugin route/exec-tool/search tests (FW7).
 *
 * The former tests/plugins/tasks/routes.test.ts godfile carried one big mock
 * scaffold: an in-memory completion-gate fake, seedable run/live-run state,
 * and mock task-store + task-service surfaces. The split files (routes-rest,
 * exec-tools, search-doc) all need the same scaffold, so it lives here once.
 *
 * IMPORTANT: bun's `mock.module(...)` calls MUST stay in each test file —
 * module mocks are per-file under `--isolate`, and hoisting them into a
 * shared helper would silently change what gets mocked. This helper only
 * exports the mock functions, module-shape factories, and the reset routine;
 * each test file wires them into its own mock.module calls (both specifiers
 * per surface — the FW1.8 dual-mock fix).
 */
import { mock } from 'bun:test'

// In-memory completion-gate fake — route tests exercise handler wiring, not
// ledger semantics (covered by tests/core/completion-gate.test.ts).
export const completionsFake = new Map<string, { taskId: string; runId: string | null; agent: string; channel: string | null; completedAt: number }>()
// Seedable per-task runs for the run-history route (the route maps these via runs-reader).
export const mockTaskRuns: Record<string, Array<Record<string, unknown>>> = {}
// Seedable live runs for the tasks_get liveRun block.
export const mockLiveRuns: Record<string, { runId: string; agent: string; startedAt: number }> = {}

export const ledgerMock = () => ({
  recordCompletion: (taskId: string, input: { runId?: string; agent: string; channel?: string }) => {
    const existing = completionsFake.get(taskId)
    if (existing) return { recorded: false as const, existing }
    completionsFake.set(taskId, { taskId, runId: input.runId ?? null, agent: input.agent, channel: input.channel ?? null, completedAt: Date.now() })
    return { recorded: true as const }
  },
  hasCompletion: (taskId: string) => completionsFake.has(taskId),
  getCompletion: (taskId: string) => completionsFake.get(taskId) ?? null,
  deleteCompletion: (taskId: string) => completionsFake.delete(taskId),
  getLiveRun: (taskId: string) => {
    const run = mockLiveRuns[taskId]
    return run ? { ...run, taskId, status: 'running' } : null
  },
  bumpHeartbeatByTask: () => {},
  listRunsByTask: (taskId: string, limit = 50) => (mockTaskRuns[taskId] ?? []).slice(0, limit),
})

// Mock taskboard functions
export const mockReadTaskboard = mock()
export const mockCreateTask = mock()
export const mockDeleteTask = mock()
export const mockAssignTask = mock()
export const mockAddTaskLog = mock()
export const mockBlockTask = mock()
export const mockUpdateTask = mock()
export const mockMoveTask = mock()
export const mockSetDependency = mock()
export const mockClearDependency = mock()
export const mockReorderTasks = mock()
export const mockGetTask = mock()
export const mockGetTaskWithColumn = mock(
  (_id: string): { task: Record<string, unknown>; column: string } | null => null,
)

export const taskStoreMock = () => ({
  readTaskboard: (...args: unknown[]) => mockReadTaskboard(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  assignTask: (...args: unknown[]) => mockAssignTask(...args),
  addTaskLog: (...args: unknown[]) => mockAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockBlockTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  moveTask: (...args: unknown[]) => mockMoveTask(...args),
  setDependency: (...args: unknown[]) => mockSetDependency(...args),
  clearDependency: (...args: unknown[]) => mockClearDependency(...args),
  reorderTasks: (...args: unknown[]) => mockReorderTasks(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  getTaskWithColumn: (...args: unknown[]) => mockGetTaskWithColumn(...(args as [string])),
  autoArchiveDoneTasks: mock().mockReturnValue(0),
  archiveOldTasks: mock().mockReturnValue(0),
})

// Mock task-service functions
export const mockMoveTaskWithEffects = mock()
export const mockBlockTaskWithEffects = mock()
export const mockCreateTaskWithEffects = mock()
export const mockReportComplete = mock()
export const mockSetDependencyWithEffects = mock()
export const mockGetTaskDetails = mock()
export const mockLogProgress = mock()
export const mockTriggerDispatch = mock()

/** Teams accepted by the mocked validateTeamRef (#189). */
export const mockKnownTeams = new Set(['development'])
/** Same class shape as the real task-service export — routes match by instanceof. */
/** Mirrors the real typed class — routes classify the 403 by instanceof. */
export class MockWorkflowTaskMoveError extends Error {
  constructor() {
    super('Workflow tasks cannot be moved to Done directly. Use bakin_exec_submit_step — the workflow engine manages task completion.')
    this.name = 'WorkflowTaskMoveError'
  }
}

export class MockTaskValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskValidationError' }
}
export const mockValidateTeamRef = mock(async (teamId: string) => {
  if (!mockKnownTeams.has(teamId)) throw new MockTaskValidationError(`Unknown team: "${teamId}"`)
})
export const mockValidateTeamAssignment = mock(async (opts: { assignee?: string; team?: string }) => {
  if (opts.assignee && opts.team) throw new MockTaskValidationError('Cannot set both an agent and a team')
  if (opts.team) await mockValidateTeamRef(opts.team)
})

export const taskServiceMock = () => ({
  moveTaskWithEffects: (...args: unknown[]) => mockMoveTaskWithEffects(...args),
  blockTaskWithEffects: (...args: unknown[]) => mockBlockTaskWithEffects(...args),
  createTaskWithEffects: async (...args: unknown[]) => {
    // Mirror the real service: assignment validation happens inside create
    // (review R10), so route tests exercise the typed-400 path.
    const opts = (args[0] ?? {}) as { assignee?: string; team?: string }
    await mockValidateTeamAssignment({ assignee: opts.assignee, team: opts.team })
    return mockCreateTaskWithEffects(...args)
  },
  reportComplete: (...args: unknown[]) => mockReportComplete(...args),
  setDependencyWithEffects: (...args: unknown[]) => mockSetDependencyWithEffects(...args),
  getTaskDetails: (...args: unknown[]) => mockGetTaskDetails(...args),
  logProgress: (...args: unknown[]) => mockLogProgress(...args),
  triggerDispatch: (...args: unknown[]) => mockTriggerDispatch(...args),
  validateTeamRef: (teamId: string) => mockValidateTeamRef(teamId),
  validateTeamAssignment: (opts: { assignee?: string; team?: string }) => mockValidateTeamAssignment(opts),
  TaskValidationError: MockTaskValidationError,
  WorkflowTaskMoveError: MockWorkflowTaskMoveError,
})

/**
 * beforeEach body shared by the split files (run after mock.clearAllMocks()).
 * bun:test's clearAllMocks only clears call history; reset implementations
 * so a previous test's mockRejectedValue doesn't leak into the next.
 */
export function resetTasksRoutesHarness(): void {
  for (const key of Object.keys(mockTaskRuns)) delete mockTaskRuns[key]
  for (const key of Object.keys(mockLiveRuns)) delete mockLiveRuns[key]
  for (const m of [
    mockReadTaskboard, mockCreateTask, mockDeleteTask, mockAssignTask,
    mockAddTaskLog, mockBlockTask, mockUpdateTask, mockMoveTask,
    mockSetDependency, mockClearDependency, mockReorderTasks, mockGetTask,
    mockMoveTaskWithEffects, mockBlockTaskWithEffects, mockCreateTaskWithEffects,
    mockReportComplete, mockSetDependencyWithEffects, mockGetTaskDetails,
    mockLogProgress, mockTriggerDispatch, mockGetTaskWithColumn,
  ]) m.mockReset()
  mockGetTaskWithColumn.mockReturnValue(null)
  completionsFake.clear()
  // Handlers destructure the completion-gate result from these two.
  mockMoveTaskWithEffects.mockResolvedValue({ alreadyComplete: false })
  mockReportComplete.mockResolvedValue({ alreadyComplete: false })
}
