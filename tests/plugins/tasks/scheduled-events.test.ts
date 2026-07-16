/**
 * tasks.scheduledEvents provider (#191) — waiting (availableAt) and due
 * (dueAt) tasks become read-only calendar events with board deep links, and
 * tasks.rescheduleEvent moves the underlying date (the one sanctioned
 * mutation). Done/archived tasks contribute nothing.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-task-events-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeEach, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), tasks: join(testDir, 'tasks') }),
  isUsingBakinHome: () => true,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

interface FixtureTask {
  id: string
  title: string
  agent?: string
  availableAt?: string
  dueAt?: string
}
const board: { columns: Record<string, FixtureTask[]> } = {
  columns: { backlog: [], todo: [], inProgress: [], review: [], blocked: [], done: [], archived: [] },
}
const updateCalls: Array<{ id: string; updates: Record<string, unknown> }> = []
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: () => board,
  updateTask: async (id: string, updates: Record<string, unknown>) => {
    updateCalls.push({ id, updates })
  },
}))

import { listScheduledTaskEvents, rescheduleTaskEvent } from '../../../plugins/tasks/lib/scheduled-events'

const RANGE = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' }

beforeEach(() => {
  for (const col of Object.values(board.columns)) col.length = 0
  updateCalls.length = 0
})

describe('listScheduledTaskEvents', () => {
  it('maps waiting and due tasks in range to typed events with deep links', async () => {
    board.columns.todo.push(
      { id: 't-wait', title: 'Waiting task', agent: 'chef', availableAt: '2026-07-03T15:00:00.000Z' },
      { id: 't-due', title: 'Deadline task', dueAt: '2026-07-05T00:00:00.000Z' },
      { id: 't-plain', title: 'No dates' },
    )
    const events = await listScheduledTaskEvents(RANGE)
    expect(events.map(e => e.id).sort()).toEqual(['t-due:due', 't-wait:scheduled'])

    const waiting = events.find(e => e.id === 't-wait:scheduled')!
    expect(waiting.pluginId).toBe('tasks')
    expect(waiting.kind).toBe('task-scheduled')
    expect(waiting.startsAt).toBe('2026-07-03T15:00:00.000Z')
    expect(waiting.url).toBe('/tasks?taskId=t-wait')
    expect(waiting.reschedulable).toBe(true)

    const due = events.find(e => e.id === 't-due:due')!
    expect(due.kind).toBe('task-due')
    expect(due.dueAt).toBe('2026-07-05T00:00:00.000Z')
  })

  it('a task with both dates contributes two events', async () => {
    board.columns.todo.push({
      id: 't-both', title: 'Both', availableAt: '2026-07-02T00:00:00.000Z', dueAt: '2026-07-06T00:00:00.000Z',
    })
    const events = await listScheduledTaskEvents(RANGE)
    expect(events.map(e => e.kind).sort()).toEqual(['task-due', 'task-scheduled'])
  })

  it('excludes done/archived tasks and dates outside the range', async () => {
    board.columns.done.push({ id: 't-done', title: 'Done', dueAt: '2026-07-05T00:00:00.000Z' })
    board.columns.archived.push({ id: 't-arch', title: 'Archived', availableAt: '2026-07-03T00:00:00.000Z' })
    board.columns.todo.push({ id: 't-out', title: 'Out of range', dueAt: '2026-08-01T00:00:00.000Z' })
    expect(await listScheduledTaskEvents(RANGE)).toEqual([])
  })
})

describe('rescheduleTaskEvent', () => {
  it('moves availableAt for a scheduled event', async () => {
    board.columns.todo.push({ id: 't-wait', title: 'Waiting', availableAt: '2026-07-03T15:00:00.000Z' })
    const result = await rescheduleTaskEvent({ eventId: 't-wait:scheduled', to: '2026-07-04T15:00:00.000Z' })
    expect(result).toEqual({ ok: true })
    expect(updateCalls).toEqual([{ id: 't-wait', updates: { availableAt: '2026-07-04T15:00:00.000Z' } }])
  })

  it('moves dueAt for a due event', async () => {
    board.columns.todo.push({ id: 't-due', title: 'Due', dueAt: '2026-07-05T00:00:00.000Z' })
    const result = await rescheduleTaskEvent({ eventId: 't-due:due', to: '2026-07-06T00:00:00.000Z' })
    expect(result).toEqual({ ok: true })
    expect(updateCalls).toEqual([{ id: 't-due', updates: { dueAt: '2026-07-06T00:00:00.000Z' } }])
  })

  it('rejects an unknown event id and a malformed instant, mutating nothing', async () => {
    board.columns.todo.push({ id: 't-wait', title: 'Waiting', availableAt: '2026-07-03T15:00:00.000Z' })
    const unknown = await rescheduleTaskEvent({ eventId: 'ghost:scheduled', to: '2026-07-04T00:00:00.000Z' })
    expect(unknown.ok).toBe(false)
    const badDate = await rescheduleTaskEvent({ eventId: 't-wait:scheduled', to: 'tuesday-ish' })
    expect(badDate.ok).toBe(false)
    expect(updateCalls).toEqual([])
  })
})
