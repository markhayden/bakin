/**
 * Unit tests for the tasks runs-reader outcome derivation (#476).
 * readTaskOutcome joins the completion ledger with the task column —
 * completion row wins; otherwise the column maps to the outcome state.
 */
import { describe, it, expect, mock } from 'bun:test'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// In-memory fakes — this test exercises derivation, not ledger/store semantics.
const completions = new Map<string, { taskId: string; runId: string | null; agent: string; channel: string | null; completedAt: number }>()
const board = new Map<string, { task: { id: string; title: string }; column: string }>()

const ledgerMock = () => ({
  getCompletion: (taskId: string) => completions.get(taskId) ?? null,
  listRunsByTask: () => [],
})
mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../../src/core/execution-ledger', ledgerMock)

const storeMock = () => ({
  getTaskWithColumn: (id: string) => board.get(id) ?? null,
})
mock.module('@/core/task-store', storeMock)
mock.module('../../../src/core/task-store', storeMock)

const { readTaskOutcome } = await import('@bakin/tasks/lib/runs-reader')

const COMPLETED_AT = Date.UTC(2026, 5, 8, 12, 0, 0)

function seed(taskId: string, opts: { column?: string; completed?: boolean }) {
  completions.delete(taskId)
  board.delete(taskId)
  if (opts.completed) {
    completions.set(taskId, { taskId, runId: `task:${taskId}:d1`, agent: 'pixel', channel: null, completedAt: COMPLETED_AT })
  }
  if (opts.column) {
    board.set(taskId, { task: { id: taskId, title: 'T' }, column: opts.column })
  }
}

describe('tasks/runs-reader readTaskOutcome', () => {
  it('completion row + column done → done with completedAt and agent', () => {
    seed('t1', { column: 'done', completed: true })
    expect(readTaskOutcome('t1')).toEqual({
      state: 'done',
      completedAt: new Date(COMPLETED_AT).toISOString(),
      agent: 'pixel',
    })
  })

  it('completion row wins over a later archive', () => {
    seed('t2', { column: 'archived', completed: true })
    expect(readTaskOutcome('t2')?.state).toBe('done')
    expect(readTaskOutcome('t2')?.completedAt).toBe(new Date(COMPLETED_AT).toISOString())
  })

  it('no completion + column blocked → blocked', () => {
    seed('t3', { column: 'blocked' })
    expect(readTaskOutcome('t3')).toEqual({ state: 'blocked' })
  })

  it('no completion + column archived → archived (never completed)', () => {
    seed('t4', { column: 'archived' })
    expect(readTaskOutcome('t4')).toEqual({ state: 'archived' })
  })

  it('no completion + column done → done without completion fields (legacy)', () => {
    seed('t5', { column: 'done' })
    expect(readTaskOutcome('t5')).toEqual({ state: 'done' })
  })

  it.each(['inProgress', 'todo', 'backlog', 'review'])(
    'no completion + column %s → in_progress',
    (column) => {
      seed('t6', { column })
      expect(readTaskOutcome('t6')).toEqual({ state: 'in_progress' })
    },
  )

  it('unknown task (no completion, no board entry) → undefined', () => {
    seed('t7', {})
    expect(readTaskOutcome('t7')).toBeUndefined()
  })
})
