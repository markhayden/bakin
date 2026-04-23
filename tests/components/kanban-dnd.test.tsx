// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Task, TaskColumns } from '../../plugins/tasks/types'

const { mockMove, mockUseSortable } = vi.hoisted(() => ({
  mockMove: vi.fn(),
  mockUseSortable: vi.fn(),
}))

const { queryStateDefaults } = vi.hoisted(() => ({
  queryStateDefaults: {} as Record<string, string>,
}))

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
  handleRef: vi.fn(),
  ref: vi.fn(),
  sourceRef: vi.fn(),
  targetRef: vi.fn(),
  isDragging: false,
  isDropping: false,
  isDragSource: false,
  isDropTarget: false,
}))

vi.mock('@dnd-kit/dom', () => {
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

vi.mock('@dnd-kit/helpers', () => ({
  move: (...args: unknown[]) => mockMove(...args),
}))

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: (props: any) => {
    capturedProviderProps = props
    return <div data-testid="dnd-provider">{props.children}</div>
  },
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}))

vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: (...args: unknown[]) => mockUseSortable(...args),
}))

vi.mock('../../plugins/tasks/components/kanban-column', () => ({
  KanbanColumn: ({ id, tasks }: { id: string; tasks: Task[] }) => (
    <div data-testid={`column-${id}`}>
      {tasks.map((task) => (
        <div key={task.id} data-testid={`task-${task.id}`}>{task.title}</div>
      ))}
    </div>
  ),
}))

vi.mock('../../plugins/tasks/components/delete-task-dialog', () => ({
  DeleteTaskDialog: () => null,
}))

vi.mock('../../plugins/tasks/components/block-reason-dialog', () => ({
  BlockReasonDialog: () => null,
}))

vi.mock('../../plugins/tasks/components/task-detail-dialog', () => ({
  TaskDetailDrawer: () => null,
}))

vi.mock('../../plugins/tasks/components/task-metrics', () => ({
  TaskMetrics: () => null,
}))

vi.mock('../../plugins/tasks/components/task-filters', () => ({
  TaskFilters: () => null,
}))

vi.mock('../../plugins/tasks/components/task-log-table', () => ({
  TaskLogTable: () => null,
}))

vi.mock('@/components/plugin-header', () => ({
  PluginHeader: () => null,
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: any) => <div>{agentId}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(queryStateDefaults[_key] ?? defaultValue)
  },
  useQueryArrayState: () => {
    const React = require('react') as typeof import('react')
    return React.useState([])
  },
}))

vi.mock('@/hooks/use-content-store', () => ({
  useContentStore: () => 0,
}))

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}))

vi.mock('../../plugins/tasks/hooks/use-gate-status', () => ({
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

  beforeEach(() => {
    fetchCalls = []
    capturedProviderProps = {}
    mockMove.mockClear()
    mockUseSortable.mockClear()
    for (const key of Object.keys(queryStateDefaults)) {
      delete queryStateDefaults[key]
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  async function renderBoard(columns: Partial<TaskColumns>) {
    const boardResponse = makeBoardResponse(columns)

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
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

    const { KanbanBoard } = await import('../../plugins/tasks/components/kanban-board')

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
  })
})

describe('TaskCard rendering', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the card with drag styling when isDragging is true', async () => {
    mockUseSortable.mockReturnValue({
      handleRef: vi.fn(),
      ref: vi.fn(),
      sourceRef: vi.fn(),
      targetRef: vi.fn(),
      isDragging: true,
      isDropping: false,
      isDragSource: true,
      isDropTarget: false,
    })

    const { TaskCard } = await vi.importActual<typeof import('../../plugins/tasks/components/task-card')>('../../plugins/tasks/components/task-card')

    const task = makeTask('task-1', 'Test Task')
    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onAssign={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Test Task')
    expect(container.querySelector('.ring-\\[var\\(--accent\\)\\]\\/30')).toBeTruthy()
  })

  it('renders the normal draggable card when isDragging is false', async () => {
    mockUseSortable.mockReturnValue({
      handleRef: vi.fn(),
      ref: vi.fn(),
      sourceRef: vi.fn(),
      targetRef: vi.fn(),
      isDragging: false,
      isDropping: false,
      isDragSource: false,
      isDropTarget: false,
    })

    const { TaskCard } = await vi.importActual<typeof import('../../plugins/tasks/components/task-card')>('../../plugins/tasks/components/task-card')

    const task = makeTask('task-1', 'Test Task')
    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onAssign={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Test Task')
    expect(container.querySelector('.cursor-grab')).toBeTruthy()
  })
})
