import { describe, expect, it } from 'bun:test'
import type { Task, TaskColumns } from '@bakin/tasks/types'
import { countVisibleTasks, isFutureScheduledTask, splitScheduledTasks } from '@bakin/tasks/lib/scheduled'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    checked: false,
    ...overrides,
  }
}

function columns(todo: Task[]): TaskColumns {
  return {
    backlog: [],
    todo,
    blocked: [],
    inProgress: [],
    review: [],
    done: [],
    archived: [],
  }
}

describe('scheduled task board helpers', () => {
  const now = Date.parse('2026-05-20T12:00:00Z')

  it('treats future availableAt as scheduled and invalid values as ready', () => {
    expect(isFutureScheduledTask(task('future', { availableAt: '2026-05-20T13:00:00Z' }), now)).toBe(true)
    expect(isFutureScheduledTask(task('ready', { availableAt: '2026-05-20T11:00:00Z' }), now)).toBe(false)
    expect(isFutureScheduledTask(task('invalid', { availableAt: 'not-a-date' }), now)).toBe(false)
  })

  it('keeps ready tasks first and future scheduled tasks in a separate group', () => {
    const split = splitScheduledTasks([
      task('future', { availableAt: '2026-05-20T13:00:00Z' }),
      task('ready'),
      task('due', { availableAt: '2026-05-20T12:00:00Z' }),
    ], now)

    expect(split.ready.map(item => item.id)).toEqual(['ready', 'due'])
    expect(split.scheduled.map(item => item.id)).toEqual(['future'])
  })

  it('excludes future scheduled tasks from visible counts when the board filter is off', () => {
    const board = columns([
      task('ready'),
      task('future', { availableAt: '2026-05-20T13:00:00Z' }),
    ])

    expect(countVisibleTasks(board, true, now)).toBe(2)
    expect(countVisibleTasks(board, false, now)).toBe(1)
  })
})
