import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-prepare-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

let column: string | null = 'todo'
const loseRun = mock((_runId: string, _reason: string) => true)
const moveTaskToInProgress = mock(async () => {})
const appendAudit = mock(() => {})
const fireDispatchTurn = mock(() => {})
mock.module('../../src/core/audit', () => ({ appendAudit }))
mock.module('../../src/core/execution-ledger', () => ({ loseRun }))
mock.module('../../src/core/dispatch-board', () => ({
  moveTaskToInProgress,
  findDispatchTaskSnapshot: (id: string) => (column ? { column, task: { id } } : null),
  taskAlreadyLeftActiveWork: (c: string) => c === 'done' || c === 'blocked' || c === 'review' || c === 'archived',
}))
mock.module('../../src/core/dispatch-turns', () => ({
  claimDispatchRun: () => ({ claimed: true, runId: 'task:t1:d1' }),
  auditDispatchSuppressed: mock(() => {}),
  fireDispatchTurn,
}))
mock.module('../../src/core/agent-packages/lesson-retrieval', () => ({ buildTaskLessonQuery: () => '' }))
mock.module('../../src/core/dispatch-context-blocks', () => ({
  buildDispatchLessonBlock: async () => '',
  buildDispatchAssetBlock: async () => '',
  buildDispatchBrandBlock: async () => ({ status: 'none' }),
  resolveTriageBrand: async () => ({ status: 'none' }),
  BrandUnavailableError: class extends Error {},
}))
mock.module('../../src/core/dispatch-prompts', () => ({ buildDispatchMessage: () => 'msg', buildDecompositionMessage: () => 'msg' }))

import { prepareRegularDispatch } from '../../src/core/dispatch-prepare'

const prepare = () => prepareRegularDispatch({
  task: { id: 't1', title: 'repair', agent: 'main' },
  targetAgent: 'main',
  contentDir: testDir,
  port: 3737,
  mainAgentId: 'main',
  runtimeRoster: [],
  recovery: undefined,
  continuation: {},
  logPrefix: 'test',
  isRecovery: false,
  path: 'cycle',
})

beforeEach(() => {
  column = 'todo'
  for (const fn of [loseRun, moveTaskToInProgress, appendAudit, fireDispatchTurn]) fn.mockClear()
})

describe('prepareRegularDispatch revalidates the column after its claim', () => {
  it('a todo task proceeds: moved to In Progress', async () => {
    const result = await prepare()
    expect(result.status).toBe('ready')
    expect(moveTaskToInProgress).toHaveBeenCalledTimes(1)
    expect(loseRun).not.toHaveBeenCalled()
  })

  for (const left of ['review', 'blocked', 'done', 'archived']) {
    it(`a task moved to ${left} while the pre-claim gates awaited is released, never fired or moved back`, async () => {
      column = left
      const result = await prepare()
      expect(result.status).toBe('suppressed')
      expect(loseRun).toHaveBeenCalledWith('task:t1:d1', 'task-left-active-work')
      expect(moveTaskToInProgress).not.toHaveBeenCalled()
    })
  }

  it('a task deleted before the claim is released too', async () => {
    column = null
    expect((await prepare()).status).toBe('suppressed')
    expect(loseRun).toHaveBeenCalledTimes(1)
  })
})
