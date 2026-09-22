// @vitest-environment jsdom
/**
 * `?taskId=` is the task drawer's open state (spec settings-url-state,
 * Phase 2 rules 1–2; schedule's `?jobId=` is the reference implementation).
 *
 * Before: the board consumed `?taskId=` once on load, opened the drawer from
 * a snapshot, and cleared the param — a card click never touched the URL, so
 * the drawer could not be bookmarked, refreshed, or closed with Back.
 *
 * These tests run the real board over the router shim with a stable spy
 * navigate (useLocation reads happy-dom's window.location) and pin: cold-load
 * from the URL after the board fetch, PUSH on open (Back closes), REPLACE on
 * close, delete clearing the param, and a stale id surfacing as page
 * feedback — not a toast, and not a silent URL rewrite.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Task, TaskColumns } from '../../../plugins/tasks/types'
import { settleFor } from '../../helpers/wait'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ─────────────────────────
const testDir = join(tmpdir(), `bakin-test-kanban-deep-link-${process.pid}-${Date.now()}`)
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/watcher', () => ({ registerSyncHook: mock(), registerUnlinkHook: mock() }))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(), createTask: mock(), deleteTask: mock(), assignTask: mock(), addTaskLog: mock(),
  blockTask: mock(), updateTask: mock(), moveTask: mock(), setDependency: mock(), clearDependency: mock(),
  reorderTasks: mock(), autoArchiveDoneTasks: mock().mockReturnValue(0), archiveOldTasks: mock().mockReturnValue(0),
}))
afterAll(() => { rmSync(testDir, { recursive: true, force: true }) })

// ─── dnd + child stubs (per kanban-search-signal.test.tsx) ──────────────────
mock.module('@dnd-kit/dom', () => {
  class MockPointerSensor { static configure() { return {} } }
  class MockKeyboardSensor {}
  return { PointerSensor: MockPointerSensor, KeyboardSensor: MockKeyboardSensor }
})
mock.module('@dnd-kit/helpers', () => ({ move: (items: unknown) => items }))
mock.module('@dnd-kit/react', () => ({
  DragDropProvider: (props: { children?: React.ReactNode }) => <div data-testid="dnd-provider">{props.children}</div>,
  useDroppable: () => ({ ref: mock(), isDropTarget: false }),
}))
// Columns expose the card click; the drawer exposes its open state + actions.
mock.module('../../../plugins/tasks/components/kanban-column', () => ({
  KanbanColumn: ({ id, tasks, onTaskClick }: { id: string; tasks: Task[]; onTaskClick: (task: Task, columnId: string) => void }) => (
    <div data-testid={`column-${id}`}>
      {tasks.map((task) => (
        <button key={task.id} type="button" onClick={() => onTaskClick(task, id)}>{task.title}</button>
      ))}
    </div>
  ),
}))
const drawerTasks: Array<Task | null> = []
mock.module('../../../plugins/tasks/components/task-detail-dialog', () => ({
  TaskDetailDrawer: ({ task, open, onClose, onDelete }: { task: Task | null; open: boolean; onClose: () => void; onDelete: (task: Task) => void }) => {
    drawerTasks.push(task)
    return (
      <div data-testid="drawer" data-open={String(open)} data-task={task?.id ?? ''}>
        <button type="button" onClick={onClose}>Close drawer</button>
        {task ? <button type="button" onClick={() => onDelete(task)}>Delete from drawer</button> : null}
      </div>
    )
  },
}))
mock.module('../../../plugins/tasks/components/delete-task-dialog', () => ({ DeleteTaskDialog: () => null }))
mock.module('../../../plugins/tasks/components/block-reason-dialog', () => ({ BlockReasonDialog: () => null }))
mock.module('../../../plugins/tasks/components/task-metrics', () => ({ TaskMetrics: () => null }))
mock.module('../../../plugins/tasks/components/task-filters', () => ({ TaskFilters: () => null }))
mock.module('../../../plugins/tasks/components/task-log-table', () => ({ TaskLogTable: () => null }))
mock.module('../../../plugins/tasks/hooks/use-gate-status', () => ({ useGateStatus: () => ({}) }))
mock.module('../../../plugins/tasks/hooks/use-budget-status', () => ({ useBudgetStatus: () => null, budgetHoldReason: () => null, pickTaskHold: () => null }))
mock.module('../../../plugins/tasks/hooks/use-model-holds', () => ({ useModelHolds: () => ({}) }))
mock.module('../../../plugins/tasks/hooks/use-brand-status', () => ({ useBrandStatus: () => null, brandHoldReason: () => null }))
mock.module('../../../plugins/tasks/hooks/use-live-activity', () => ({ useLiveActivity: () => ({}) }))
mock.module('@/hooks/use-content-store', () => ({ useContentStore: () => false }))

const toastSpy = mock()
mock.module('@/hooks/use-toast', () => ({
  toast: toastSpy,
  useToastStore: Object.assign(mock(() => []), { getState: () => ({ add: mock(), clear: mock() }) }),
}))

// Router shim + a STABLE spy navigate; the REAL @makinbakin/sdk/navigation
// hooks run over it, so push-vs-replace is observable.
const navigations: Array<Record<string, unknown>> = []
const navigate = (opts: Record<string, unknown>) => navigations.push(opts)
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useNavigate: () => navigate,
}))

import { KanbanBoard } from '../../../plugins/tasks/components/kanban-board'

function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

// ─── Fixtures + fetch stub ──────────────────────────────────────────────────
function makeTask(id: string, title: string, agent?: string): Task {
  return { id, title, checked: false, ...(agent ? { agent } : {}) } as Task
}
function boardResponse(columns: Partial<TaskColumns>) {
  return {
    columns: { backlog: [], todo: [], blocked: [], inProgress: [], review: [], done: [], archived: [], ...columns },
    timestamp: '2026-09-18T00:00:00Z',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const BOARD = boardResponse({
  todo: [makeTask('task-beef', 'beef stew', 'pixel'), makeTask('task-web', 'website copy', 'rolo')],
})
const realFetch = globalThis.fetch
function stubFetch(board = BOARD) {
  globalThis.fetch = mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return json({ results: [], aggregations: {}, meta: { query: '', total: 0, took_ms: 1, source: 'search' } })
    if (u.includes('/api/plugins/tasks/')) return json(board)
    return json({})
  }) as unknown as typeof fetch
}

const drawer = () => screen.getByTestId('drawer')
async function mountAt(url: string) {
  setURL(`http://localhost${url}`)
  stubFetch()
  await act(async () => { render(<KanbanBoard />) })
}

beforeEach(() => {
  navigations.length = 0
  drawerTasks.length = 0
  toastSpy.mockClear()
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  setURL('http://localhost/')
})

describe('KanbanBoard — ?taskId= drawer', () => {
  it('cold-loads the drawer from ?taskId= after the board fetch, even under filters, without navigating', async () => {
    await mountAt('/tasks?agent=pixel&taskId=task-web')
    await waitFor(() => expect(drawer().getAttribute('data-task')).toBe('task-web'))
    expect(drawer().getAttribute('data-open')).toBe('true')
    await settleFor(50, 'an inbound deep link must not be rewritten or cleared')
    expect(navigations).toHaveLength(0)
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('opening a card PUSHES ?taskId= so Back closes the drawer', async () => {
    // rolo's task stays visible under rolo's own filter; the push must keep it.
    await mountAt('/tasks?agent=rolo')
    await waitFor(() => screen.getByRole('button', { name: 'website copy' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'website copy' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/tasks', search: { agent: 'rolo', taskId: 'task-web' } })
    expect((navigations[0] as { replace?: boolean }).replace).not.toBe(true)
  })

  it('closing REPLACES ?taskId= away', async () => {
    await mountAt('/tasks?taskId=task-web')
    await waitFor(() => expect(drawer().getAttribute('data-task')).toBe('task-web'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close drawer' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/tasks', search: {}, replace: true })
  })

  it('deleting from the drawer clears ?taskId=', async () => {
    await mountAt('/tasks?taskId=task-web')
    await waitFor(() => expect(drawer().getAttribute('data-task')).toBe('task-web'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete from drawer' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/tasks', search: {}, replace: true })
  })

  it('a stale ?taskId= is page feedback with Dismiss — no toast, no silent URL rewrite', async () => {
    await mountAt('/tasks?taskId=nope')
    const alert = await waitFor(() => screen.getByTestId('tasks-task-not-found'))
    expect(alert.textContent).toContain('Task not found')
    await settleFor(50, 'the stale link stays in the address bar until the user dismisses it')
    expect(navigations).toHaveLength(0)
    expect(toastSpy).not.toHaveBeenCalled()
    expect(drawer().getAttribute('data-open')).toBe('false')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/tasks', search: {}, replace: true })
  })
})
