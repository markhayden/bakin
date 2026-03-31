import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the content module before importing taskboard
const mockFiles: Record<string, string> = {}
vi.mock('../../../src/lib/content', () => ({
  readContentFile: vi.fn((name: string) => mockFiles[name] || null),
  writeContentFile: vi.fn((name: string, content: string) => {
    mockFiles[name] = content
  }),
}))

// Mock cancelInstance (called on some transitions)
vi.mock('../../../plugins/workflows/runtime', () => ({
  cancelInstance: vi.fn(),
}))

import { moveTask, createTask, readTaskboard, addTaskLog, blockTask, VALID_TRANSITIONS, localDateString } from '../../../plugins/tasks/taskboard'
import type { ColumnId } from '../../../plugins/tasks/types'

function seedTaskboard(md: string) {
  mockFiles['TASKBOARD.md'] = md
}

function makeTask(id: string, column: string, opts: { log?: boolean } = {}) {
  const logSection = opts.log ? `\n  [2026-03-20 10:00 pixel] Did work` : ''
  return `- [ ] [${id}] Task ${id} @pixel${logSection}`
}

function seedColumns(columns: Partial<Record<ColumnId, string[]>>) {
  let md = '# Task Board\n_Last updated: 03/20/2026, 10:00 MDT_\n'
  const allCols: Record<ColumnId, { header: string }> = {
    backlog: { header: '📦 Backlog' },
    inProgress: { header: '🔵 In Progress' },
    todo: { header: '📋 Todo' },
    review: { header: '🔍 Review' },
    done: { header: '✅ Done' },
    confirmed: { header: '🟣 Confirmed' },
    blocked: { header: '🔴 Blocked' },
  }
  for (const [colId, config] of Object.entries(allCols)) {
    md += `\n## ${config.header}\n`
    const tasks = columns[colId as ColumnId] || []
    for (const taskMd of tasks) {
      md += taskMd + '\n'
    }
  }
  seedTaskboard(md)
}

describe('VALID_TRANSITIONS', () => {
  it('allows inProgress → review', () => {
    expect(VALID_TRANSITIONS.inProgress).toContain('review')
  })

  it('allows review → inProgress', () => {
    expect(VALID_TRANSITIONS.review).toContain('inProgress')
  })

  it('allows review → todo', () => {
    expect(VALID_TRANSITIONS.review).toContain('todo')
  })

  it('allows review → done', () => {
    expect(VALID_TRANSITIONS.review).toContain('done')
  })

  it('does NOT allow review → blocked', () => {
    expect(VALID_TRANSITIONS.review).not.toContain('blocked')
  })

  it('does NOT allow todo → review directly', () => {
    expect(VALID_TRANSITIONS.todo).not.toContain('review')
  })

  it('allows confirmed → done and todo', () => {
    expect(VALID_TRANSITIONS.confirmed).toContain('done')
    expect(VALID_TRANSITIONS.confirmed).toContain('todo')
  })

  it('allows done → inProgress', () => {
    expect(VALID_TRANSITIONS.done).toContain('inProgress')
  })
})

describe('moveTask — review column', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('moves task from inProgress to review', async () => {
    seedColumns({
      inProgress: [makeTask('aaa11111', 'inProgress')],
    })

    await moveTask('aaa11111', 'review')

    const board = readTaskboard()
    expect(board.columns.inProgress).toHaveLength(0)
    expect(board.columns.review).toHaveLength(1)
    expect(board.columns.review[0].id).toBe('aaa11111')
  })

  it('sets date when moving to review', async () => {
    seedColumns({
      inProgress: [makeTask('aaa11111', 'inProgress')],
    })

    await moveTask('aaa11111', 'review')

    const board = readTaskboard()
    expect(board.columns.review[0].date).toBeDefined()
  })

  it('keeps checked=false when moving to review', async () => {
    seedColumns({
      inProgress: [makeTask('aaa11111', 'inProgress')],
    })

    await moveTask('aaa11111', 'review')

    const board = readTaskboard()
    expect(board.columns.review[0].checked).toBe(false)
  })

  it('moves task from review back to inProgress', async () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review')],
    })

    await moveTask('aaa11111', 'inProgress')

    const board = readTaskboard()
    expect(board.columns.review).toHaveLength(0)
    expect(board.columns.inProgress).toHaveLength(1)
    expect(board.columns.inProgress[0].id).toBe('aaa11111')
  })

  it('moves task from review to todo', async () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review')],
    })

    await moveTask('aaa11111', 'todo')

    const board = readTaskboard()
    expect(board.columns.review).toHaveLength(0)
    expect(board.columns.todo).toHaveLength(1)
  })

  it('allows review → done (with log)', async () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review', { log: true })],
    })

    await moveTask('aaa11111', 'done')

    const board = readTaskboard()
    expect(board.columns.done).toHaveLength(1)
    expect(board.columns.done[0].checked).toBe(true)
  })

  it('rejects review → blocked (invalid transition)', async () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review')],
    })

    await expect(moveTask('aaa11111', 'blocked')).rejects.toThrow('Invalid transition')
  })

  it('rejects todo → review (invalid transition)', async () => {
    seedColumns({
      todo: [makeTask('aaa11111', 'todo')],
    })

    await expect(moveTask('aaa11111', 'review')).rejects.toThrow('Invalid transition')
  })
})

describe('moveTask — existing transitions still work', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('moves inProgress → done (requires log)', async () => {
    seedColumns({
      inProgress: [makeTask('aaa11111', 'inProgress', { log: true })],
    })

    await moveTask('aaa11111', 'done')

    const board = readTaskboard()
    expect(board.columns.done).toHaveLength(1)
    expect(board.columns.done[0].checked).toBe(true)
  })

  it('rejects inProgress → done without log', async () => {
    seedColumns({
      inProgress: [makeTask('aaa11111', 'inProgress')],
    })

    await expect(moveTask('aaa11111', 'done')).rejects.toThrow('no log entries')
  })

  it('moves done → confirmed', async () => {
    seedColumns({
      done: ['- [x] [aaa11111] Task aaa11111 @pixel'],
    })

    await moveTask('aaa11111', 'confirmed')

    const board = readTaskboard()
    expect(board.columns.confirmed).toHaveLength(1)
  })

  it('allows moves from confirmed to done', async () => {
    seedColumns({
      confirmed: ['- [x] [aaa11111] Task aaa11111 @pixel\n  [2026-03-20 10:00 pixel] Did work'],
    })

    await moveTask('aaa11111', 'done')

    const board = readTaskboard()
    expect(board.columns.done).toHaveLength(1)
  })

  it('allows moves from confirmed to todo', async () => {
    seedColumns({
      confirmed: ['- [x] [aaa11111] Task aaa11111 @pixel'],
    })

    await moveTask('aaa11111', 'todo')

    const board = readTaskboard()
    expect(board.columns.todo).toHaveLength(1)
  })

  it('rejects confirmed → blocked (invalid transition)', async () => {
    seedColumns({
      confirmed: ['- [x] [aaa11111] Task aaa11111 @pixel'],
    })

    await expect(moveTask('aaa11111', 'blocked')).rejects.toThrow('Invalid transition')
  })
})

describe('readTaskboard — review column', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('returns empty review array when no taskboard exists', () => {
    const board = readTaskboard()
    expect(board.columns.review).toEqual([])
  })

  it('parses review column from markdown', () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review')],
    })

    const board = readTaskboard()
    expect(board.columns.review).toHaveLength(1)
    expect(board.columns.review[0].id).toBe('aaa11111')
  })
})

describe('serialization round-trip', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('preserves review column through create → read cycle', async () => {
    // Start with empty board
    seedColumns({})

    // Create a task, move it through inProgress → review
    const task = await createTask('Gate test task', 'inProgress', 'pixel')
    await addTaskLog(task.id, 'pixel', 'Starting work')
    await moveTask(task.id, 'review')

    // Re-read and verify
    const board = readTaskboard()
    expect(board.columns.review).toHaveLength(1)
    expect(board.columns.review[0].title).toBe('Gate test task')

    // Verify the serialized markdown contains the review header
    const md = mockFiles['TASKBOARD.md']
    expect(md).toContain('## 🔍 Review')
  })
})

describe('localDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = localDateString()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches local date, not UTC', () => {
    const result = localDateString()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(result).toBe(expected)
  })

  it('pads single-digit months and days', () => {
    // The function always pads — verify format even if today is double-digit
    const result = localDateString()
    const parts = result.split('-')
    expect(parts[1]).toHaveLength(2)
    expect(parts[2]).toHaveLength(2)
  })
})

describe('createTask — date handling', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('sets date for inProgress tasks', async () => {
    seedColumns({})
    const task = await createTask('Test task', 'inProgress', 'pixel')

    const board = readTaskboard()
    const created = board.columns.inProgress.find(t => t.id === task.id)
    expect(created?.date).toBe(localDateString())
  })

  it('sets date for done tasks', async () => {
    seedColumns({})
    const task = await createTask('Test task', 'done', 'pixel')

    const board = readTaskboard()
    const created = board.columns.done.find(t => t.id === task.id)
    expect(created?.date).toBe(localDateString())
  })

  it('does not set date for todo tasks', async () => {
    seedColumns({})
    const task = await createTask('Test task', 'todo', 'pixel')

    const board = readTaskboard()
    const created = board.columns.todo.find(t => t.id === task.id)
    expect(created?.date).toBeUndefined()
  })

  it('sets checked=true for done column', async () => {
    seedColumns({})
    const task = await createTask('Test task', 'done', 'pixel')

    const board = readTaskboard()
    const created = board.columns.done.find(t => t.id === task.id)
    expect(created?.checked).toBe(true)
  })
})

describe('moveTask — date and checked handling', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach(k => delete mockFiles[k])
  })

  it('sets date when moving to confirmed', async () => {
    seedColumns({
      done: ['- [x] [aaa11111] Task aaa11111 @pixel\n  [2026-03-20 10:00 pixel] Did work'],
    })

    await moveTask('aaa11111', 'confirmed')

    const board = readTaskboard()
    expect(board.columns.confirmed[0].date).toBe(localDateString())
    expect(board.columns.confirmed[0].checked).toBe(true)
  })

  it('sets checked=false when moving from done back to todo', async () => {
    seedColumns({
      done: ['- [x] [aaa11111] Task aaa11111 @pixel\n  [2026-03-20 10:00 pixel] Did work'],
    })

    await moveTask('aaa11111', 'todo')

    const board = readTaskboard()
    expect(board.columns.todo[0].checked).toBe(false)
  })
})
