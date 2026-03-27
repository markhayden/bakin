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

import { moveTask, createTask, readTaskboard, addTaskLog, blockTask, VALID_TRANSITIONS } from '../../../plugins/tasks/taskboard'
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

  it('does NOT allow review → done directly', () => {
    expect(VALID_TRANSITIONS.review).not.toContain('done')
  })

  it('does NOT allow review → blocked', () => {
    expect(VALID_TRANSITIONS.review).not.toContain('blocked')
  })

  it('does NOT allow todo → review directly', () => {
    expect(VALID_TRANSITIONS.todo).not.toContain('review')
  })

  it('confirmed is terminal', () => {
    expect(VALID_TRANSITIONS.confirmed).toHaveLength(0)
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

  it('rejects review → done (invalid transition)', async () => {
    seedColumns({
      review: [makeTask('aaa11111', 'review', { log: true })],
    })

    await expect(moveTask('aaa11111', 'done')).rejects.toThrow('Invalid transition')
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

  it('rejects moves out of confirmed (terminal)', async () => {
    seedColumns({
      confirmed: ['- [x] [aaa11111] Task aaa11111 @pixel'],
    })

    await expect(moveTask('aaa11111', 'todo')).rejects.toThrow('Invalid transition')
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
