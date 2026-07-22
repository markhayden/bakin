/**
 * ⚠ QUARANTINED to a serial gating step (package.json + both CI workflows).
 * settleBoard (this describe's afterEach) drains the post-persist refetch to
 * FETCH-QUIESCENCE before rtl-settle unmounts — the file passes reliably in
 * isolation AND in CI's own serial step. But folding it back into the
 * --parallel pool (#650 attempt) destabilized a NEIGHBOR under 2-vCPU
 * contention (an intermittent file-level error elsewhere), so it stays
 * serial. Prior rounds: cross-file pollution (#638), leaked roots (#640),
 * inner-hook cleanup preemption (#643). Do not re-add to the parallel run
 * without resolving the contention flake; tracking #650.
 */
// @vitest-environment jsdom

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleReact } from '../rtl-settle'
import type { Task, TaskColumns } from '../../plugins/tasks/types'

const testDir = join(tmpdir(), `bakin-test-kanban-dnd-${process.pid}-${Date.now()}`)

const { mockMove, mockUseSortable } = (() => ({
  mockMove: mock(),
  mockUseSortable: mock(),
}))()

const { queryStateDefaults } = (() => ({
  queryStateDefaults: {} as Record<string, string>,
}))()

let capturedProviderProps: Record<string, any> = {}

const COLUMN_IDS = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as const

function findTaskColumn(columns: TaskColumns, taskId: string) {
  return COLUMN_IDS.find((columnId) => columns[columnId].some((task) => task.id === taskId)) ?? null
}

function cloneColumns(columns: TaskColumns): TaskColumns {
  return {
    backlog: [...columns.backlog],
    todo: [...columns.todo],
    blocked: [...columns.blocked],
    inProgress: [...columns.inProgress],
    review: [...columns.review],
    done: [...columns.done],
    archived: [...columns.archived],
  }
}

mockMove.mockImplementation((items: TaskColumns, event: any) => {
  const source = event.operation?.source
  const target = event.operation?.target

  if (!source || !target) {
    return items
  }

  const sourceId = String(source.id)
  const sourceColumn = (source.data?.columnId ?? source.data?.group ?? findTaskColumn(items, sourceId)) as keyof TaskColumns | null
  const targetColumn = (
    target.data?.columnId ??
    target.data?.group ??
    (COLUMN_IDS.includes(String(target.id) as any) ? String(target.id) : null)
  ) as keyof TaskColumns | null

  if (!sourceColumn || !targetColumn) {
    return items
  }

  const task = items[sourceColumn].find((entry) => entry.id === sourceId)
  if (!task) {
    return items
  }

  const next = cloneColumns(items)

  for (const columnId of COLUMN_IDS) {
    next[columnId] = next[columnId].filter((entry) => entry.id !== sourceId)
  }

  const insertIndex = typeof target.data?.insertIndex === 'number'
    ? target.data.insertIndex
    : COLUMN_IDS.includes(String(target.id) as any)
      ? next[targetColumn].length
      : Math.max(0, next[targetColumn].findIndex((entry) => entry.id === String(target.id)))

  next[targetColumn].splice(insertIndex, 0, task)
  return next
})

mockUseSortable.mockImplementation(() => ({
  handleRef: mock(),
  ref: mock(),
  sourceRef: mock(),
  targetRef: mock(),
  isDragging: false,
  isDropping: false,
  isDragSource: false,
  isDropTarget: false,
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

mock.module('@dnd-kit/dom', () => {
  class MockPointerSensor {
    static configure() {
      return {}
    }
  }

  class MockKeyboardSensor {}

  return {
    PointerSensor: MockPointerSensor,
    KeyboardSensor: MockKeyboardSensor,
  }
})

mock.module('@dnd-kit/helpers', () => ({
  move: (...args: unknown[]) => mockMove(...args),
}))

mock.module('@dnd-kit/react', () => ({
  DragDropProvider: (props: any) => {
    capturedProviderProps = props
    return <div data-testid="dnd-provider">{props.children}</div>
  },
  useDroppable: () => ({ ref: mock(), isDropTarget: false }),
}))

mock.module('@dnd-kit/react/sortable', () => ({
  useSortable: (...args: unknown[]) => mockUseSortable(...args),
}))

mock.module('../../plugins/tasks/components/kanban-column', () => ({
  KanbanColumn: ({ id, tasks }: { id: string; tasks: Task[] }) => (
    <div data-testid={`column-${id}`}>
      {tasks.map((task) => (
        <div key={task.id} data-testid={`task-${task.id}`}>{task.title}</div>
      ))}
    </div>
  ),
}))

mock.module('../../plugins/tasks/components/delete-task-dialog', () => ({
  DeleteTaskDialog: () => null,
}))

mock.module('../../plugins/tasks/components/block-reason-dialog', () => ({
  BlockReasonDialog: () => null,
}))

mock.module('../../plugins/tasks/components/task-detail-dialog', () => ({
  TaskDetailDrawer: () => null,
}))

mock.module('../../plugins/tasks/components/task-metrics', () => ({
  TaskMetrics: () => null,
}))

mock.module('../../plugins/tasks/components/task-filters', () => ({
  TaskFilters: () => null,
}))

mock.module('../../plugins/tasks/components/task-log-table', () => ({
  TaskLogTable: () => null,
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: any) => <div>{agentId}</div>,
}))

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
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
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(queryStateDefaults[_key] ?? defaultValue)
  },
  useQueryArrayState: () => {
    const React = require('react') as typeof import('react')
    return React.useState<string[]>([])
  },
}))

mock.module('@/hooks/use-content-store', () => ({
  useContentStore: () => 0,
}))

mock.module('@/hooks/use-toast', () => ({
  toast: mock(),
  useToastStore: Object.assign(mock(() => []), { getState: () => ({ add: mock(), clear: mock() }) }),
}))

mock.module('../../plugins/tasks/hooks/use-gate-status', () => ({
  useGateStatus: () => ({}),
}))

function makeTask(id: string, title: string, overrides?: Partial<Task>): Task {
  return { id, title, checked: false, ...overrides }
}

function makeBoardResponse(columns: Partial<TaskColumns>) {
  return {
    columns: {
      backlog: [],
      todo: [],
      blocked: [],
      inProgress: [],
      review: [],
      done: [],
      archived: [],
      ...columns,
    },
    timestamp: '2026-04-07T00:00:00Z',
  }
}

function makeDragEvent(options: {
  sourceId: string
  sourceData: any
  targetId?: string
  targetData?: any
  canceled?: boolean
}) {
  return {
    canceled: options.canceled ?? false,
    operation: {
      source: {
        id: options.sourceId,
        type: 'item',
        data: options.sourceData,
      },
      target: options.targetId
        ? {
            id: options.targetId,
            type: COLUMN_IDS.includes(options.targetId as any) ? 'column' : 'item',
            data: options.targetData ?? {},
          }
        : null,
    },
  }
}

describe('KanbanBoard drag and drop', () => {
  let fetchCalls: Array<{ url: string; body: any; method: string }>
  let fetchCount = 0

  beforeEach(() => {
    fetchCalls = []
    fetchCount = 0
    capturedProviderProps = {}
    mockMove.mockClear()
    mockUseSortable.mockClear()
    for (const key of Object.keys(queryStateDefaults)) {
      delete queryStateDefaults[key]
    }
  })

  async function settleBoard(): Promise<void> {
    let stableRounds = 0
    let lastCount = -1
    for (let i = 0; i < 60 && stableRounds < 4; i++) {
      await new Promise((r) => setTimeout(r, 0)) // macrotask: fetch json() + scheduler continuation
      await settleReact(1)                       // let the resulting render slice commit
      if (fetchCount === lastCount) stableRounds++
      else { stableRounds = 0; lastCount = fetchCount }
    }
  }

  // Runs BEFORE the imported rtl-settle afterEach (describe-scoped hooks fire
  // first) — so the post-persist refetch cascade is fully drained before the
  // root is unmounted. This is the #650 fix: the flake was that refetch
  // render landing after the fixed-round settle, racing teardown on slow CI.
  afterEach(async () => {
    await settleBoard()
    mock.restore()
  })

  async function renderBoard(columns: Partial<TaskColumns>) {
    const boardResponse = makeBoardResponse(columns)

    vi.stubGlobal('fetch', mock(async (url: string, init?: RequestInit) => {
      fetchCount++ // every call, incl. the post-persist GET refetch
      if (init?.method && init.method !== 'GET') {
        fetchCalls.push({
          url,
          body: init.body ? JSON.parse(init.body as string) : null,
          method: init.method,
        })
        return { ok: true, json: async () => ({}) } as Response
      }

      return { ok: true, json: async () => boardResponse } as Response
    }))

    const { KanbanBoard } = require('../../plugins/tasks/components/kanban-board') as typeof import('../../plugins/tasks/components/kanban-board')

    await act(async () => {
      render(<KanbanBoard />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('dnd-provider')).toBeTruthy()
    })
  }

  function getColumnTaskTitles(columnId: string) {
    const column = screen.getByTestId(`column-${columnId}`)
    return Array.from(column.querySelectorAll('[data-testid^="task-"]')).map((el) => el.textContent)
  }

  it('same-column reorder calls /reorder with the optimistic order', async () => {
    const task1 = makeTask('task-1', 'First')
    const task2 = makeTask('task-2', 'Second')
    const task3 = makeTask('task-3', 'Third')

    await renderBoard({ todo: [task1, task2, task3] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: task1, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: task1, columnId: 'todo', group: 'todo' },
        targetId: 'todo',
        targetData: { columnId: 'todo', group: 'todo', insertIndex: 2 },
      }))
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: task1, columnId: 'todo', group: 'todo' },
        targetId: 'todo',
        targetData: { columnId: 'todo', group: 'todo', insertIndex: 2 },
      }))
    })

    await waitFor(() => {
      const reorderCall = fetchCalls.find((call) => call.url.includes('/reorder'))
      expect(reorderCall).toBeTruthy()
      expect(reorderCall!.body).toEqual({
        columnId: 'todo',
        orderedIds: ['task-2', 'task-3', 'task-1'],
      })
    })

    // Let the post-persist refetch's re-render complete — the reorder
    // assertion above races the response-handling setState (see rtl-settle).
    await settleReact()
  })

  it('cross-column move to populated column calls /move and both /reorder endpoints', async () => {
    const moveMe = makeTask('task-1', 'Move Me')
    const existingA = makeTask('task-2', 'Existing A')
    const existingB = makeTask('task-3', 'Existing B')

    await renderBoard({ todo: [moveMe], inProgress: [existingA, existingB] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 1 },
      }))
    })

    await waitFor(() => {
      expect(getColumnTaskTitles('inProgress')).toEqual(['Existing A', 'Move Me', 'Existing B'])
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 1 },
      }))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find((call) => call.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.from).toBe('todo')
      expect(moveCall!.body.to).toBe('inProgress')

      const reorderCalls = fetchCalls.filter((call) => call.url.includes('/reorder'))
      expect(reorderCalls).toHaveLength(2)
      expect(reorderCalls.map((call) => call.body.columnId).sort()).toEqual(['inProgress', 'todo'])
    })

    // Settle the post-persist refetch re-render before the test ends (see
    // rtl-settle — the fetch-call assertion races the response handling).
    await settleReact()
  })

  it('cross-column move to empty column calls /move', async () => {
    const moveMe = makeTask('task-1', 'Move Me')

    await renderBoard({ todo: [moveMe], inProgress: [] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      expect(getColumnTaskTitles('inProgress')).toEqual(['Move Me'])
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find((call) => call.url.includes('/move'))
      expect(moveCall!.body.to).toBe('inProgress')
    })

    // Settle the post-persist refetch re-render before the test ends (see
    // rtl-settle — the fetch-call assertion races the response handling).
    await settleReact()
  })

  it('canceled drag restores state with no API calls', async () => {
    const moveMe = makeTask('task-1', 'Move Me')
    const stayHere = makeTask('task-2', 'Stay Here')

    await renderBoard({ todo: [moveMe], inProgress: [stayHere] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 1 },
      }))
    })

    await waitFor(() => {
      expect(getColumnTaskTitles('inProgress')).toEqual(['Stay Here', 'Move Me'])
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 1 },
        canceled: true,
      }))
    })

    await waitFor(() => {
      expect(getColumnTaskTitles('todo')).toEqual(['Move Me'])
      expect(fetchCalls).toHaveLength(0)
    })
  })

  it('drag end with no target is a no-op', async () => {
    const task = makeTask('task-1', 'Task')

    await renderBoard({ todo: [task] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
      }))
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
      }))
    })

    expect(fetchCalls).toHaveLength(0)
  })

  it('uses the drag-start column for persistence, not stale source data on drop', async () => {
    const moveMe = makeTask('task-1', 'Move Me')

    await renderBoard({ todo: [moveMe], inProgress: [] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'todo', group: 'todo' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 0 },
      }))
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task: moveMe, columnId: 'inProgress', group: 'inProgress' },
        targetId: 'inProgress',
        targetData: { columnId: 'inProgress', group: 'inProgress', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find((call) => call.url.includes('/move'))
      expect(moveCall!.body.from).toBe('todo')
      expect(moveCall!.body.to).toBe('inProgress')
    })

    // Settle the post-persist refetch re-render before the test ends (see
    // rtl-settle — the fetch-call assertion races the response handling).
    await settleReact()
  })

  it('drop on blocked defers to the block dialog path', async () => {
    const task = makeTask('task-1', 'Block Me')

    await renderBoard({ todo: [task], blocked: [] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
      }))
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
        targetId: 'blocked',
        targetData: { columnId: 'blocked', group: 'blocked', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find((call) => call.url.includes('/move'))
      expect(moveCall).toBeFalsy()
    })

    // Settle the post-persist refetch re-render before the test ends (see
    // rtl-settle — the fetch-call assertion races the response handling).
    await settleReact()
  })

  it('drop on archived calls /move with to=archived', async () => {
    const task = makeTask('task-1', 'Archive Me')

    await renderBoard({ todo: [task], archived: [] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
      }))
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-1',
        sourceData: { task, columnId: 'todo', group: 'todo' },
        targetId: 'archived',
        targetData: { columnId: 'archived', group: 'archived', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find((call) => call.url.includes('/move'))
      expect(moveCall!.body.to).toBe('archived')
    })

    // Settle the post-persist refetch re-render before the test ends (see
    // rtl-settle — the fetch-call assertion races the response handling).
    await settleReact()
  })

  it('same-column reorder with search filter preserves hidden task positions', async () => {
    queryStateDefaults.q = 'match'

    const hiddenTop = makeTask('task-1', 'Alpha')
    const visibleA = makeTask('task-2', 'Match A')
    const hiddenMiddle = makeTask('task-3', 'Bravo')
    const visibleB = makeTask('task-4', 'Match B')

    await renderBoard({ todo: [hiddenTop, visibleA, hiddenMiddle, visibleB] })

    act(() => {
      capturedProviderProps.onDragStart(makeDragEvent({
        sourceId: 'task-4',
        sourceData: { task: visibleB, columnId: 'todo', group: 'todo' },
      }))
    })

    act(() => {
      capturedProviderProps.onDragOver(makeDragEvent({
        sourceId: 'task-4',
        sourceData: { task: visibleB, columnId: 'todo', group: 'todo' },
        targetId: 'todo',
        targetData: { columnId: 'todo', group: 'todo', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      expect(getColumnTaskTitles('todo')).toEqual(['Match B', 'Match A'])
    })

    await act(async () => {
      await capturedProviderProps.onDragEnd(makeDragEvent({
        sourceId: 'task-4',
        sourceData: { task: visibleB, columnId: 'todo', group: 'todo' },
        targetId: 'todo',
        targetData: { columnId: 'todo', group: 'todo', insertIndex: 0 },
      }))
    })

    await waitFor(() => {
      const reorderCall = fetchCalls.find((call) => call.url.includes('/reorder'))
      expect(reorderCall).toBeTruthy()
      expect(reorderCall!.body).toEqual({
        columnId: 'todo',
        orderedIds: ['task-1', 'task-4', 'task-3', 'task-2'],
      })
    })

    // Let the post-persist refetch's re-render complete — the reorder
    // assertion above races the response-handling setState (see rtl-settle).
    await settleReact()
  })
})

describe('TaskCard rendering', () => {
  afterEach(() => {
    mock.restore()
  })

  it('renders the card with drag styling when isDragging is true', async () => {
    mockUseSortable.mockReturnValue({
      handleRef: mock(),
      ref: mock(),
      sourceRef: mock(),
      targetRef: mock(),
      isDragging: true,
      isDropping: false,
      isDragSource: true,
      isDropTarget: false,
    })

    const { TaskCard } = require('../../plugins/tasks/components/task-card') as typeof import('../../plugins/tasks/components/task-card')

    const task = makeTask('task-1', 'Test Task')
    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onDelete={mock()}
        onClick={mock()}
      />
    )

    expect(container.textContent).toContain('Test Task')
    expect(container.querySelector('.ring-\\[var\\(--accent\\)\\]\\/30')).toBeTruthy()
  })

  it('renders the normal draggable card when isDragging is false', async () => {
    mockUseSortable.mockReturnValue({
      handleRef: mock(),
      ref: mock(),
      sourceRef: mock(),
      targetRef: mock(),
      isDragging: false,
      isDropping: false,
      isDragSource: false,
      isDropTarget: false,
    })

    const { TaskCard } = require('../../plugins/tasks/components/task-card') as typeof import('../../plugins/tasks/components/task-card')

    const task = makeTask('task-1', 'Test Task')
    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onDelete={mock()}
        onClick={mock()}
      />
    )

    expect(container.textContent).toContain('Test Task')
    expect(container.querySelector('.cursor-grab')).toBeTruthy()
  })
})
