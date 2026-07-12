// @vitest-environment jsdom

/**
 * KanbanBoard — honest search signals (spec D11 / search-trust-and-speed
 * WS6/T16).
 *
 * Uses the REAL `useTaskFilters` + `useSearch` chain with `fetch` stubbed so
 * `/api/plugins/tasks/search` answers 503 `{ error: 'search_unavailable' }`
 * (engine down) or a `meta.partial` response (budget degrade). The board must
 * show:
 *   - a loading indicator while the search is in flight,
 *   - the "Search is unavailable — showing basic text matching" chip on 503
 *     WHILE the substring fallback keeps the board browsable,
 *   - the SearchPartialChip when the response is partial.
 *
 * Child components are stubbed following tests/components/kanban-dnd.test.tsx.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Task, TaskColumns } from '../../../plugins/tasks/types'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ─────────────────────────

const testDir = join(tmpdir(), `bakin-test-kanban-signal-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
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

// task-store is not used by the board component itself but is mocked
// defensively per CLAUDE.md isolation rules — no transitive ~/.bakin writes.
mock.module('@/core/task-store', () => ({
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

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── dnd + child stubs (per kanban-dnd.test.tsx) ────────────────────────────

mock.module('@dnd-kit/dom', () => {
  class MockPointerSensor {
    static configure() { return {} }
  }
  class MockKeyboardSensor {}
  return { PointerSensor: MockPointerSensor, KeyboardSensor: MockKeyboardSensor }
})

mock.module('@dnd-kit/helpers', () => ({
  move: (items: unknown) => items,
}))

mock.module('@dnd-kit/react', () => ({
  DragDropProvider: (props: { children?: React.ReactNode }) => (
    <div data-testid="dnd-provider">{props.children}</div>
  ),
  useDroppable: () => ({ ref: mock(), isDropTarget: false }),
}))

mock.module('../../../plugins/tasks/components/kanban-column', () => ({
  KanbanColumn: ({ id, tasks }: { id: string; tasks: Task[] }) => (
    <div data-testid={`column-${id}`}>
      {tasks.map((task) => (
        <div key={task.id} data-testid={`task-${task.id}`}>{task.title}</div>
      ))}
    </div>
  ),
}))

mock.module('../../../plugins/tasks/components/delete-task-dialog', () => ({
  DeleteTaskDialog: () => null,
}))
mock.module('../../../plugins/tasks/components/block-reason-dialog', () => ({
  BlockReasonDialog: () => null,
}))
mock.module('../../../plugins/tasks/components/task-detail-dialog', () => ({
  TaskDetailDrawer: () => null,
}))
mock.module('../../../plugins/tasks/components/task-metrics', () => ({
  TaskMetrics: () => null,
}))
mock.module('../../../plugins/tasks/components/task-filters', () => ({
  TaskFilters: () => null,
}))
mock.module('../../../plugins/tasks/components/task-log-table', () => ({
  TaskLogTable: () => null,
}))
mock.module('../../../plugins/tasks/hooks/use-gate-status', () => ({
  useGateStatus: () => ({}),
}))

mock.module('@/components/plugin-header', () => ({
  PluginHeader: ({ search }: { search?: { value: string; onChange: (v: string) => void } }) => (
    <div data-testid="plugin-header">
      {search && <input aria-label="search" value={search.value} onChange={(e) => search.onChange(e.target.value)} />}
    </div>
  ),
}))

mock.module('@/hooks/use-content-store', () => ({
  useContentStore: () => 0,
}))

mock.module('@/hooks/use-toast', () => ({
  toast: mock(),
  useToastStore: Object.assign(mock(() => []), { getState: () => ({ add: mock(), clear: mock() }) }),
}))

// URL state — primed per test.
const queryStateDefaults: Record<string, string> = {}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(queryStateDefaults[key] ?? defaultValue)
  },
  useQueryArrayState: () => {
    const React = require('react') as typeof import('react')
    return React.useState([])
  },
}))

// Import AFTER mocks. useTaskFilters + useSearch stay REAL — the degraded
// states arrive through the stubbed fetch, exactly like production.
import { KanbanBoard } from '../../../plugins/tasks/components/kanban-board'

// ─── Fixtures + fetch stub ──────────────────────────────────────────────────

function makeTask(id: string, title: string): Task {
  return { id, title, checked: false }
}

function boardResponse(columns: Partial<TaskColumns>) {
  return {
    columns: {
      backlog: [], todo: [], blocked: [], inProgress: [], review: [], done: [], archived: [],
      ...columns,
    },
    timestamp: '2026-07-11T00:00:00Z',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BOARD = boardResponse({
  todo: [makeTask('task-beef', 'beef stew'), makeTask('task-web', 'website copy')],
})

/** Board loads fine; the search leg is controlled per test. */
function stubFetch(searchImpl: () => Response) {
  vi.stubGlobal('fetch', mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return searchImpl()
    if (u.includes('/api/plugins/tasks/')) return json(BOARD)
    return json({})
  }))
}

beforeEach(() => {
  for (const key of Object.keys(queryStateDefaults)) delete queryStateDefaults[key]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('KanbanBoard — search signals', () => {
  it('shows loading, then the degraded chip on 503 — and keeps the substring fallback browsable', async () => {
    stubFetch(() => json({ error: 'search_unavailable' }, 503))
    queryStateDefaults.q = 'beef'

    await act(async () => {
      render(<KanbanBoard />)
    })

    // In-flight search (debounce + request) → visible loading indicator.
    await waitFor(() => {
      expect(screen.getByTestId('tasks-search-loading')).toBeDefined()
    })

    // Engine down → the honest degraded chip…
    await waitFor(() => {
      expect(screen.getByTestId('tasks-search-degraded')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.queryByTestId('tasks-search-loading')).toBeNull()

    // …while basic text matching keeps the board usable (the fix is the
    // SIGNAL — the fallback stays).
    expect(screen.getByTestId('task-task-beef')).toBeDefined()
    expect(screen.queryByTestId('task-task-web')).toBeNull()
  })

  it('shows the SearchPartialChip when the search response is partial', async () => {
    stubFetch(() => json({
      results: [{ id: 'task-beef', table: 'bakin_tasks', score: 0.9, fields: {} }],
      aggregations: {},
      meta: {
        query: 'beef',
        total: 1,
        took_ms: 12,
        source: 'search',
        partial: true,
        tables: [{ table: 'bakin_tasks', hits: 1, took_ms: 12, budget: 'degraded' as const }],
      },
    }))
    queryStateDefaults.q = 'beef'

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('search-partial-chip')).toBeDefined()
    }, { timeout: 3000 })
    // No degraded chip — the engine answered, just not completely.
    expect(screen.queryByTestId('tasks-search-degraded')).toBeNull()
    expect(screen.getByTestId('task-task-beef')).toBeDefined()
  })

  it('renders no signal row for a healthy complete search', async () => {
    stubFetch(() => json({
      results: [{ id: 'task-beef', table: 'bakin_tasks', score: 0.9, fields: {} }],
      aggregations: {},
      meta: { query: 'beef', total: 1, took_ms: 5, source: 'search' },
    }))
    queryStateDefaults.q = 'beef'

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('task-task-beef')).toBeDefined()
      expect(screen.queryByTestId('tasks-search-loading')).toBeNull()
    }, { timeout: 3000 })
    expect(screen.queryByTestId('tasks-search-degraded')).toBeNull()
    expect(screen.queryByTestId('search-partial-chip')).toBeNull()
  })
})
