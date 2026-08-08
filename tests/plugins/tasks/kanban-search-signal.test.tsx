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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
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

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
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

let contentLoading = false

mock.module('@/hooks/use-content-store', () => ({
  useContentStore: () => contentLoading,
}))

mock.module('@/hooks/use-toast', () => ({
  toast: mock(),
  useToastStore: Object.assign(mock(() => []), { getState: () => ({ add: mock(), clear: mock() }) }),
}))

// URL state — primed per test.
const queryStateDefaults: Record<string, string> = {}

function useTestQueryState(key: string, defaultValue: string) {
  const React = require('react') as typeof import('react')
  return React.useState(queryStateDefaults[key] ?? defaultValue)
}

function useTestQueryArrayState() {
  const React = require('react') as typeof import('react')
  return React.useState<string[]>([])
}

mock.module('@makinbakin/sdk/navigation', () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: mock(),
    forward: mock(),
    refresh: mock(),
    prefetch: mock(),
  }),
  useSearchParams: () => new URLSearchParams(),
  useQueryState: useTestQueryState,
  useQueryArrayState: useTestQueryArrayState,
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
function stubFetch(searchImpl: () => Response, board = BOARD) {
  vi.stubGlobal('fetch', mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return searchImpl()
    if (u.includes('/api/plugins/tasks/')) return json(board)
    return json({})
  }))
}

beforeEach(() => {
  contentLoading = false
  for (const key of Object.keys(queryStateDefaults)) delete queryStateDefaults[key]
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('KanbanBoard — search signals', () => {
  it('keeps canonical page identity and controls around the task result region', async () => {
    stubFetch(() => json({
      results: [],
      aggregations: {},
      meta: { query: '', total: 0, took_ms: 1, source: 'search' },
    }))

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      // The board rides the immersive workspace frame (the workflows frame).
      expect(document.querySelector('[data-archetype="workspace"]')).toBeTruthy()
    })
    expect(document.querySelector('[data-archetype="workspace"]')?.getAttribute('data-mode')).toBe('immersive')
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Task search, view, and actions' })).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Task search' })
    const board = screen.getByRole('tab', { name: 'Board' })
    // Two New Task buttons exist by design: the full header's and the
    // sticky compact row's (visibility is viewport-driven, not DOM-driven).
    const newTask = screen.getAllByRole('button', { name: 'New Task' })[0]!
    expect(search.className).toContain('h-[var(--bakin-layout-size-control)]')
    expect(board.className).toContain('h-[var(--bakin-layout-size-control)]')
    expect(newTask.className).toContain('h-[var(--bakin-layout-size-control)]')
    expect(screen.getByRole('region', { name: 'Task results' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Task board' })).toBeTruthy()
  })

  it('keeps the page identity visible while only the result region is loading', async () => {
    contentLoading = true
    stubFetch(() => json({ results: [], aggregations: {} }))

    await act(async () => {
      render(<KanbanBoard />)
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Loading tasks' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Task results' }).getAttribute('data-content-state')).toBe('replaced')
  })

  it('uses the canonical first-use state when the board has no tasks', async () => {
    stubFetch(
      () => json({ results: [], aggregations: {} }),
      boardResponse({}),
    )

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeTruthy()
    })
    expect(within(screen.getByRole('region', { name: 'Task results' })).getByRole('button', { name: 'Create first task' })).toBeTruthy()
  })

  it('replaces only the result region with a recoverable board-load error', async () => {
    let boardAttempts = 0
    vi.stubGlobal('fetch', mock(async (url: string | URL) => {
      if (String(url).includes('/api/plugins/tasks/')) {
        boardAttempts += 1
        return boardAttempts === 1
          ? json({ error: 'unavailable' }, 503)
          : json(BOARD)
      }
      return json({})
    }))

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Tasks could not be loaded' })).toBeTruthy()
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Task results' }).getAttribute('data-content-state')).toBe('replaced')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Task results' }).getAttribute('data-content-state')).toBe('ready')
    })
    expect(boardAttempts).toBe(2)
  })

  it('offers one clear action when active filters return no board tasks', async () => {
    stubFetch(() => json({
      results: [],
      aggregations: {},
      meta: { query: 'missing', total: 0, took_ms: 2, source: 'search' },
    }))
    queryStateDefaults.q = 'missing'

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No tasks match this view' })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Task results' }).getAttribute('data-content-state')).toBe('replaced')
  })

  it('shows loading, then the degraded chip on 503 — and keeps the substring fallback browsable', async () => {
    stubFetch(() => json({ error: 'search_unavailable' }, 503))
    queryStateDefaults.q = 'beef'

    await act(async () => {
      render(<KanbanBoard />)
    })

    // In-flight search (debounce + request) stays inside the search field so
    // the result region does not jump when a request begins.
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Task search' }).getAttribute('aria-busy')).toBe('true')
    })
    expect(screen.queryAllByTestId('tasks-search-loading')).toHaveLength(0)

    // Engine down → the honest degraded chip…
    await waitFor(() => {
      expect(screen.getByTestId('tasks-search-degraded')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.getByRole('searchbox', { name: 'Task search' }).getAttribute('aria-busy')).toBeNull()

    // …while basic text matching keeps the board usable (the fix is the
    // SIGNAL — the fallback stays).
    expect(screen.getByTestId('task-task-beef')).toBeDefined()
    expect(screen.queryAllByTestId('task-task-web').length).toBe(0)
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
    expect(screen.queryAllByTestId('tasks-search-degraded').length).toBe(0)
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

    // Drain the scheduler first: on CI's 2-vCPU runners the fetch-response
    // re-render can still be time-sliced when waitFor starts, and the
    // spinner assertion must observe the SETTLED state (see rtl-settle).
    await settleReact()
    await waitFor(() => {
      expect(screen.queryAllByTestId('task-task-beef').length).toBe(1)
      expect(screen.queryAllByTestId('tasks-search-loading').length).toBe(0)
    }, { timeout: 10_000 })
    expect(screen.queryAllByTestId('tasks-search-degraded').length).toBe(0)
    expect(screen.queryAllByTestId('search-partial-chip').length).toBe(0)
    await settleReact()
  })
})
