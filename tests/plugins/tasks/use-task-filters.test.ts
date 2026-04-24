// @vitest-environment jsdom

/**
 * Tests for the tasks plugin `useTaskFilters` hook and the pure
 * `filterBoardColumns` helper. The hook calls `useSearch` from
 * `@/hooks/use-search`, which we stub so each test can drive the
 * `results` array deterministically.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { renderHook, cleanup } from '@testing-library/react'

const testDir = join(tmpdir(), `bakin-test-tasks-filters-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

mock.module('@/core/openclaw-client', () => ({
  sendToAgent: mock(async () => ({ ok: true })),
}))

// flow-store is not used by use-task-filters.ts but is mocked defensively
// per CLAUDE.md isolation rules to prevent any transitive write to ~/.bakin/.
mock.module('@bakin/tasks/lib/flow-store', () => ({
  readTaskboard: mock(),
  createTask: mock(),
  deleteTask: mock(),
  assignTask: mock(),
  addTaskLog: mock(),
  blockTask: mock(),
  updateTask: mock(),
  moveTask: mock(),
  setDependency: mock(),
  clearDependency: mock(),
  reorderTasks: mock(),
  autoArchiveDoneTasks: mock().mockReturnValue(0),
  archiveOldTasks: mock().mockReturnValue(0),
}))

// ─── useSearch stub ─────────────────────────────────────────────────────────
//
// The hook under test calls `useSearch({ plugin: 'tasks', ... })`. We expose
// a writable `mockSearchState` that each test mutates BEFORE calling
// renderHook so the stub returns the appropriate `results` array.

interface MockSearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
}

const mockSearchState: {
  results: MockSearchResult[]
  aggregations: Record<string, Array<{ value: string; count: number }>>
} = {
  results: [],
  aggregations: {},
}

const searchSpy = mock()
const clearSpy = mock()

mock.module('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: mockSearchState.results,
    aggregations: mockSearchState.aggregations,
    loading: false,
    error: null,
    meta: null,
    search: searchSpy,
    clear: clearSpy,
  }),
  reorderBySearchResults: <T extends { id: string }>(items: T[], results: MockSearchResult[]): T[] => {
    if (!results.length) return items
    const scoreMap = new Map<string, number>()
    for (const r of results) scoreMap.set(r.id, r.score)
    const matched: T[] = []
    const unmatched: T[] = []
    for (const item of items) {
      if (scoreMap.has(item.id)) matched.push(item)
      else unmatched.push(item)
    }
    matched.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
    return [...matched, ...unmatched]
  },
}))

// Import AFTER mocks so the hook picks up the stubbed useSearch.
import { useTaskFilters, filterBoardColumns } from '@bakin/tasks/hooks/use-task-filters'
import type { Task, TaskColumns } from '@bakin/tasks/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    checked: false,
    ...overrides,
  }
}

function emptyColumns(): TaskColumns {
  return {
    backlog: [],
    todo: [],
    blocked: [],
    inProgress: [],
    review: [],
    done: [],
    archived: [],
  }
}

function makeColumns(): TaskColumns {
  return {
    backlog: [task('a', { title: 'apple', agent: 'pixel' })],
    todo: [task('b', { title: 'banana', agent: 'mochi' })],
    blocked: [],
    inProgress: [task('c', { title: 'cherry', agent: 'pixel' })],
    review: [task('d', { title: 'date', agent: 'mochi' })],
    done: [task('e', { title: 'elderberry', agent: 'pixel' })],
    archived: [],
  }
}

beforeEach(() => {
  mockSearchState.results = []
  mockSearchState.aggregations = {}
  searchSpy.mockClear()
  clearSpy.mockClear()
  cleanup()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── filterBoardColumns (pure helper) ──────────────────────────────────────

describe('filterBoardColumns', () => {
  it('returns columns unchanged when no filters applied', () => {
    const cols = makeColumns()
    const filtered = filterBoardColumns(cols, '', 'all')
    expect(filtered.backlog.map(t => t.id)).toEqual(['a'])
    expect(filtered.inProgress.map(t => t.id)).toEqual(['c'])
    expect(filtered.done.map(t => t.id)).toEqual(['e'])
  })

  it('filters by agent across all columns', () => {
    const cols = makeColumns()
    const filtered = filterBoardColumns(cols, '', 'pixel')
    expect(filtered.backlog.map(t => t.id)).toEqual(['a'])
    expect(filtered.todo).toEqual([])
    expect(filtered.inProgress.map(t => t.id)).toEqual(['c'])
    expect(filtered.review).toEqual([])
    expect(filtered.done.map(t => t.id)).toEqual(['e'])
  })

  it('uses local matchesSearch when no search results are passed', () => {
    const cols = makeColumns()
    const filtered = filterBoardColumns(cols, 'banana', 'all')
    expect(filtered.todo.map(t => t.id)).toEqual(['b'])
    expect(filtered.backlog).toEqual([])
  })

  it('filters by matchIds when search results are provided', () => {
    const cols = makeColumns()
    const filtered = filterBoardColumns(cols, 'foo', 'all', [
      { id: 'a', table: 'bakin_tasks', score: 0.9, fields: {} },
      { id: 'e', table: 'bakin_tasks', score: 0.7, fields: {} },
    ])
    expect(filtered.backlog.map(t => t.id)).toEqual(['a'])
    expect(filtered.todo).toEqual([])
    expect(filtered.done.map(t => t.id)).toEqual(['e'])
  })
})

// ─── useTaskFilters hook ───────────────────────────────────────────────────

describe('useTaskFilters', () => {
  it('returns all tasks unfiltered when search is empty', () => {
    const cols = makeColumns()
    const { result } = renderHook(() =>
      useTaskFilters(cols, { search: '', agentFilter: 'all', statusFilter: [] }),
    )

    expect(result.current.allTasksFlat.map(t => t.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(result.current.filteredColumns.backlog.map(t => t.id)).toEqual(['a'])
  })

  it('filters columns by matchIds and reorders by score when search returns hits', () => {
    mockSearchState.results = [
      { id: 'e', table: 'bakin_tasks', score: 0.95, fields: {} },
      { id: 'a', table: 'bakin_tasks', score: 0.40, fields: {} },
    ]

    const cols = makeColumns()
    const { result } = renderHook(() =>
      useTaskFilters(cols, { search: 'fruit', agentFilter: 'all', statusFilter: [] }),
    )

    // Each column independently filters by matchIds + reorders by score.
    expect(result.current.filteredColumns.backlog.map(t => t.id)).toEqual(['a'])
    expect(result.current.filteredColumns.done.map(t => t.id)).toEqual(['e'])
    expect(result.current.filteredColumns.todo).toEqual([])

    // Flat list preserves only matched ids and orders by descending score.
    expect(result.current.allTasksFlat.map(t => t.id)).toEqual(['e', 'a'])
  })

  it('falls back to local matchesSearch when search results are empty', () => {
    mockSearchState.results = []

    const cols = makeColumns()
    const { result } = renderHook(() =>
      useTaskFilters(cols, { search: 'banana', agentFilter: 'all', statusFilter: [] }),
    )

    // 'banana' only matches task 'b' via local title match.
    expect(result.current.allTasksFlat.map(t => t.id)).toEqual(['b'])
    expect(result.current.filteredColumns.todo.map(t => t.id)).toEqual(['b'])
    expect(result.current.filteredColumns.backlog).toEqual([])
  })

  it('filters flat tasks by agentFilter', () => {
    const cols = makeColumns()
    const { result } = renderHook(() =>
      useTaskFilters(cols, { search: '', agentFilter: 'pixel', statusFilter: [] }),
    )

    expect(result.current.allTasksFlat.map(t => t.id)).toEqual(['a', 'c', 'e'])
  })

  it('filters flat tasks by statusFilter', () => {
    const cols = makeColumns()
    const { result } = renderHook(() =>
      useTaskFilters(cols, { search: '', agentFilter: 'all', statusFilter: ['todo', 'done'] }),
    )

    expect(result.current.allTasksFlat.map(t => t.id)).toEqual(['b', 'e'])
  })

  it('handles empty columns without crashing', () => {
    const { result } = renderHook(() =>
      useTaskFilters(emptyColumns(), { search: '', agentFilter: 'all', statusFilter: [] }),
    )
    expect(result.current.allTasksFlat).toEqual([])
  })
})
