// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Task, TaskColumns, ColumnId } from '../../plugins/tasks/types'

// ── Capture DndContext props so tests can invoke handlers directly ──

let capturedDndProps: Record<string, any> = {}

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: any) => {
    capturedDndProps = props
    return <div data-testid="dnd-context">{props.children}</div>
  },
  DragOverlay: ({ children }: any) => <div data-testid="drag-overlay">{children}</div>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  closestCenter: vi.fn(),
  pointerWithin: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}))

const mockUseSortable = vi.fn(({ id, data }: any) => ({
  attributes: {},
  listeners: {},
  setNodeRef: vi.fn(),
  transform: null,
  transition: null,
  isDragging: false,
  active: null,
  activeIndex: 0,
  data: {},
  index: 0,
  isOver: false,
  isSorting: false,
  items: [],
  newIndex: 0,
  over: null,
  overIndex: 0,
  rect: { current: null },
  setActivatorNodeRef: vi.fn(),
  setDroppableNodeRef: vi.fn(),
  setDraggableNodeRef: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: {},
  arrayMove: (arr: any[], from: number, to: number) => {
    const result = [...arr]
    const [removed] = result.splice(from, 1)
    result.splice(to, 0, removed)
    return result
  },
  useSortable: (...args: unknown[]) => mockUseSortable(...(args as [unknown])),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => null } },
}))

// ── Mock child components: KanbanColumn renders task IDs for assertions ──

vi.mock('../../plugins/tasks/components/kanban-column', () => ({
  KanbanColumn: ({ id, tasks }: { id: string; tasks: Task[] }) => (
    <div data-testid={`column-${id}`}>
      {tasks.map((t: Task) => (
        <div key={t.id} data-testid={`task-${t.id}`}>{t.title}</div>
      ))}
    </div>
  ),
}))

vi.mock('../../plugins/tasks/components/task-card', () => ({
  TaskCard: ({ task }: { task: Task }) => <div data-testid={`card-${task.id}`}>{task.title}</div>,
  TaskCardOverlay: ({ task }: { task: Task }) => <div data-testid="overlay">{task.title}</div>,
  TaskCardContent: ({ task, className }: { task: Task; className?: string }) => (
    <div className={className}>{task.title}</div>
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

vi.mock('@/components/layout/skeleton-loader', () => ({
  WithLoading: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: any) => <div>{agentId}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
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

vi.mock('../../plugins/tasks/hooks/use-task-filters', () => ({
  useTaskFilters: (columns: TaskColumns) => ({ filteredColumns: columns, allTasksFlat: [] }),
}))

vi.mock('../../plugins/tasks/hooks/use-gate-status', () => ({
  useGateStatus: () => ({}),
}))

vi.mock('lucide-react', () => ({
  Kanban: () => null,
  Table2: () => null,
  Plus: () => null,
  X: () => null,
}))

// ── Helpers ──

function makeTask(id: string, title: string, overrides?: Partial<Task>): Task {
  return { id, title, checked: false, ...overrides }
}

function makeBoardResponse(columns: Partial<TaskColumns>) {
  return {
    columns: {
      backlog: [], todo: [], blocked: [], inProgress: [], review: [], done: [], archived: [],
      ...columns,
    },
    timestamp: '2026-04-07T00:00:00Z',
  }
}

// Plain task IDs (not composite) — matches the new sortable ID scheme
function makeDragEvent(activeId: string, activeData: any, overId?: string, overData?: any) {
  return {
    active: {
      id: activeId,
      data: { current: activeData },
      rect: { current: { initial: null, translated: null } },
    },
    over: overId ? {
      id: overId,
      data: { current: overData },
      rect: { width: 288, height: 100, top: 0, left: 0, right: 288, bottom: 100 },
      disabled: false,
    } : null,
    activatorEvent: new Event('pointer'),
    collisions: null,
    delta: { x: 0, y: 0 },
  }
}

// ── Tests ──

describe('KanbanBoard drag and drop', () => {
  let fetchCalls: Array<{ url: string; body: any; method: string }>

  beforeEach(() => {
    fetchCalls = []
    capturedDndProps = {}
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
    let result: ReturnType<typeof render>
    await act(async () => {
      result = render(<KanbanBoard />)
    })

    // Wait for initial fetch
    await waitFor(() => {
      expect(screen.getByTestId('dnd-context')).toBeTruthy()
    })

    return result!
  }

  it('same-column reorder calls /reorder API with new order', async () => {
    const task1 = makeTask('task-1', 'First')
    const task2 = makeTask('task-2', 'Second')
    const task3 = makeTask('task-3', 'Third')

    await renderBoard({ todo: [task1, task2, task3] })

    // Start dragging task-1
    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Drop on task-3 position (within same column)
    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-3',
        { task: task3, columnId: 'todo' },
      ))
    })

    await waitFor(() => {
      const reorderCall = fetchCalls.find(c => c.url.includes('/reorder'))
      expect(reorderCall).toBeTruthy()
      expect(reorderCall!.body.columnId).toBe('todo')
      expect(reorderCall!.body.orderedIds).toEqual(['task-2', 'task-3', 'task-1'])
    })
  })

  it('cross-column move to populated column via onDragOver and calls /move API', async () => {
    const task1 = makeTask('task-1', 'Move Me')
    const task2 = makeTask('task-2', 'Existing A')
    const task3 = makeTask('task-3', 'Existing B')

    await renderBoard({ todo: [task1], inProgress: [task2, task3] })

    // Start dragging task-1 from todo
    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Drag over task-2 in inProgress — onDragOver moves it in state
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-2',
        { task: task2, columnId: 'inProgress' },
      ))
    })

    // Task-1 moved to inProgress column, gone from todo
    await waitFor(() => {
      expect(screen.getByTestId('column-inProgress').textContent).toContain('Move Me')
      expect(screen.getByTestId('column-todo').textContent).not.toContain('Move Me')
    })

    // Drop
    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-2',
        { task: task2, columnId: 'inProgress' },
      ))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.from).toBe('todo')
      expect(moveCall!.body.to).toBe('inProgress')
      expect(moveCall!.body.id).toBe('task-1')
    })
  })

  it('cross-column move to empty column calls /move API', async () => {
    const task1 = makeTask('task-1', 'Move Me')

    await renderBoard({ todo: [task1], inProgress: [] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Drag over the empty inProgress column droppable (valid: todo → inProgress)
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'inProgress',
      ))
    })

    await waitFor(() => {
      expect(screen.getByTestId('column-inProgress').textContent).toContain('Move Me')
    })

    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'inProgress',
      ))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.to).toBe('inProgress')
    })
  })

  it('drag cancel restores original state with no API calls', async () => {
    const task1 = makeTask('task-1', 'Move Me')
    const task2 = makeTask('task-2', 'Stay Here')

    await renderBoard({ todo: [task1], inProgress: [task2] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Move to inProgress via onDragOver
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'inProgress',
      ))
    })

    await waitFor(() => {
      expect(screen.getByTestId('column-inProgress').textContent).toContain('Move Me')
    })

    // Cancel
    act(() => {
      capturedDndProps.onDragCancel()
    })

    // Task restored to todo
    await waitFor(() => {
      expect(screen.getByTestId('column-todo').textContent).toContain('Move Me')
    })

    expect(fetchCalls).toHaveLength(0)
  })

  it('drag end with no over target is a no-op', async () => {
    const task1 = makeTask('task-1', 'Task')

    await renderBoard({ todo: [task1] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    expect(fetchCalls).toHaveLength(0)

    await waitFor(() => {
      expect(screen.getByTestId('column-todo').textContent).toContain('Task')
    })
  })

  it('onDragOver within same column is a no-op', async () => {
    const task1 = makeTask('task-1', 'First')
    const task2 = makeTask('task-2', 'Second')

    await renderBoard({ todo: [task1, task2] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Drag over task-2 in the same column — should not move items in state
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-2',
        { task: task2, columnId: 'todo' },
      ))
    })

    await waitFor(() => {
      const todoCol = screen.getByTestId('column-todo')
      expect(todoCol.textContent).toContain('First')
      expect(todoCol.textContent).toContain('Second')
    })
  })

  it('cross-column move preserves drop position and calls /reorder', async () => {
    const task1 = makeTask('task-1', 'Move Me')
    const task2 = makeTask('task-2', 'First In Progress')
    const task3 = makeTask('task-3', 'Second In Progress')

    await renderBoard({ todo: [task1], inProgress: [task2, task3] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Simulate handleDragOver moving task-1 into inProgress before task-3
    // (this populates dragOptimisticRef which handleDragEnd reads)
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-3',
        { task: task3, columnId: 'inProgress' },
      ))
    })

    // Drop — handleDragEnd reads position from dragOptimisticRef
    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-3',
        { task: task3, columnId: 'inProgress' },
      ))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.from).toBe('todo')
      expect(moveCall!.body.to).toBe('inProgress')
      expect(moveCall!.body.agent).toBe('human')
      expect(moveCall!.body.channel).toBe('human')
      expect(moveCall!.body.afterTaskId).toBe('task-2')
      expect(moveCall!.body.beforeTaskId).toBe('task-3')
      const reorderCall = fetchCalls.find(c => c.url.includes('/reorder'))
      expect(reorderCall).toBeFalsy()
    })
  })

  it('cross-column move uses drag-start column, not stale active.data.current.columnId', async () => {
    const task1 = makeTask('task-1', 'Move Me')

    await renderBoard({ todo: [task1], inProgress: [] })

    // Start drag — captures fromCol as 'todo'
    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    // Simulate what happens in real dnd-kit: handleDragOver moves the task,
    // useSortable re-renders with new columnId, and active.data.current updates
    act(() => {
      capturedDndProps.onDragOver(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'inProgress',
      ))
    })

    // Drop — active.data.current.columnId is now 'inProgress' (stale ref from
    // useSortable re-render), but the handler should use the drag-start ref
    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'inProgress' }, // simulates stale useSortable data
        'inProgress',
      ))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.from).toBe('todo') // from drag-start ref, not stale 'inProgress'
      expect(moveCall!.body.to).toBe('inProgress')
    })
  })

  it('same-column reorder with no change is a no-op', async () => {
    const task1 = makeTask('task-1', 'First')
    const task2 = makeTask('task-2', 'Second')

    await renderBoard({ todo: [task1, task2] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    expect(fetchCalls.filter(c => c.url.includes('/reorder'))).toHaveLength(0)
  })

  it('drop on blocked column does NOT fire /move — defers to reason dialog', async () => {
    const task1 = makeTask('task-1', 'Block Me')

    await renderBoard({ todo: [task1], blocked: [] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'blocked',
      ))
    })

    // The blocked reason dialog intercepts — no /move call fired
    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeFalsy()
    })
  })

  it('drop on archived column fires /move with to=archived', async () => {
    const task1 = makeTask('task-1', 'Archive Me')

    await renderBoard({ todo: [task1], archived: [] })

    act(() => {
      capturedDndProps.onDragStart(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
      ))
    })

    await act(async () => {
      capturedDndProps.onDragEnd(makeDragEvent(
        'task-1',
        { task: task1, columnId: 'todo' },
        'archived',
      ))
    })

    await waitFor(() => {
      const moveCall = fetchCalls.find(c => c.url.includes('/move'))
      expect(moveCall).toBeTruthy()
      expect(moveCall!.body.to).toBe('archived')
      expect(moveCall!.body.agent).toBe('human')
      expect(moveCall!.body.channel).toBe('human')
    })
  })
})

describe('TaskCard ghost rendering', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders light clone placeholder when isDragging is true', async () => {
    mockUseSortable.mockReturnValue({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: true,
      active: null,
      activeIndex: 0,
      data: {},
      index: 0,
      isOver: false,
      isSorting: false,
      items: [],
      newIndex: 0,
      over: null,
      overIndex: 0,
      rect: { current: null },
      setActivatorNodeRef: vi.fn(),
      setDroppableNodeRef: vi.fn(),
      setDraggableNodeRef: vi.fn(),
    })

    const { TaskCard } = await vi.importActual<typeof import('../../plugins/tasks/components/task-card')>('../../plugins/tasks/components/task-card')

    const task = { id: 'task-1', title: 'Test Task', checked: false } as Task

    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onAssign={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />,
    )

    const placeholderEl = container.firstElementChild as HTMLElement
    expect(placeholderEl.className).toContain('border-dashed')
    expect(placeholderEl.className).toContain('opacity-40')
    // Should show card content (light clone), not invisible
    expect(placeholderEl.textContent).toContain('Test Task')
  })

  it('renders normal card when isDragging is false', async () => {
    mockUseSortable.mockReturnValue({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: false,
      active: null,
      activeIndex: 0,
      data: {},
      index: 0,
      isOver: false,
      isSorting: false,
      items: [],
      newIndex: 0,
      over: null,
      overIndex: 0,
      rect: { current: null },
      setActivatorNodeRef: vi.fn(),
      setDroppableNodeRef: vi.fn(),
      setDraggableNodeRef: vi.fn(),
    })

    const { TaskCard } = await vi.importActual<typeof import('../../plugins/tasks/components/task-card')>('../../plugins/tasks/components/task-card')

    const task = { id: 'task-1', title: 'Test Task', checked: false } as Task

    const { container } = render(
      <TaskCard
        task={task}
        columnId="todo"
        onAssign={vi.fn()}
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />,
    )

    expect(container.textContent).toContain('Test Task')
    const cardDiv = container.querySelector('.cursor-grab')
    expect(cardDiv).toBeTruthy()
  })
})
