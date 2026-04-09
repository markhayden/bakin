'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { KanbanColumn } from './kanban-column'
import { TaskCardOverlay } from './task-card'
import { DeleteTaskDialog } from './delete-task-dialog'
import { BlockReasonDialog } from './block-reason-dialog'
import { TaskDetailDrawer } from './task-detail-dialog'
import { TaskMetrics } from './task-metrics'
import { PluginHeader } from '@/components/plugin-header'
import { TaskFilters } from './task-filters'
import { TaskLogTable } from './task-log-table'
import { useTaskFilters } from '../hooks/use-task-filters'
import { WithLoading } from '@/components/layout/skeleton-loader'
import { useContentStore } from '@/hooks/use-content-store'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import { toast } from '@/hooks/use-toast'
import { useGateStatus } from '../hooks/use-gate-status'
import { Button } from '@/components/ui/button'
import { Kanban, Table2, Plus } from 'lucide-react'
import type { Task, TaskColumns, ColumnId } from '../types'

const COLUMN_ORDER: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived']

const multiContainerCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  return closestCenter(args)
}

async function apiFetch(url: string, body: Record<string, unknown>, method = 'POST'): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }))
      toast(data.error || `Request failed (${res.status})`, 'error')
      return false
    }
    return true
  } catch (err) {
    toast('Network error — server may be down', 'error')
    return false
  }
}

const emptyBoard: TaskColumns = { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] }

export function KanbanBoard() {
  const [boardData, setBoardData] = useState<{ columns: TaskColumns; timestamp?: string }>({ columns: emptyBoard })
  const taskboardVersion = useContentStore((s) => s.taskboardVersion)

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/tasks/')
      if (res.ok) {
        const data = await res.json()
        setBoardData({ columns: data.columns ?? emptyBoard, timestamp: data.timestamp })
      }
    } catch { /* SSE will eventually re-trigger */ }
  }, [])

  // Initial load + re-fetch on SSE taskboard events (via store version bump)
  useEffect(() => { fetchBoard() }, [fetchBoard, taskboardVersion])

  const refreshTaskboard = useCallback(async () => {
    await fetchBoard()
  }, [fetchBoard])

  const parsed = boardData

  // Optimistic overrides — applied on top of parsed data
  const [optimistic, setOptimistic] = useState<{ columns: TaskColumns } | null>(null)
  const columns = optimistic?.columns ?? parsed.columns
  const { timestamp } = parsed

  // URL-backed filter & view state
  const [view, setView] = useQueryState('view', 'kanban')
  const [search, setSearch] = useQueryState('q', '')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [statusFilter, setStatusFilter] = useQueryArrayState('status')

  // Filter archived column to last 24 hours for kanban display (table view shows all)
  const displayColumns = useMemo(() => {
    if (view === 'table') return columns
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return {
      ...columns,
      archived: columns.archived.filter(t => {
        if (!t.date) return true
        // Parse YYYY-MM-DD as local time, not UTC
        const d = new Date(t.date.includes('T') ? t.date : t.date + 'T00:00')
        return d.getTime() >= cutoff
      }),
    }
  }, [columns, view])

  const hiddenArchivedCount = columns.archived.length - displayColumns.archived.length

  const [taskIdParam, setTaskIdParam] = useQueryState('taskId', '')

  const { filteredColumns, allTasksFlat } = useTaskFilters(displayColumns, {
    search, agentFilter, statusFilter,
  })

  // Collect workflow task IDs for gate status polling
  const workflowTaskIds = useMemo(() => {
    const ids: string[] = []
    for (const col of Object.values(columns)) {
      for (const task of col) {
        if (task.workflowId) ids.push(task.id)
      }
    }
    return ids
  }, [columns])
  const gateStatuses = useGateStatus(workflowTaskIds)

  // Build a taskId → gate label map and childTask map for cards
  const gateLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [taskId, status] of Object.entries(gateStatuses)) {
      if (status && !status.childTaskId) labels[taskId] = status.label
    }
    return labels
  }, [gateStatuses])

  const childTaskLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [taskId, status] of Object.entries(gateStatuses)) {
      if (status?.childTaskId) labels[taskId] = status.childTaskId
    }
    return labels
  }, [gateStatuses])

  // Drag overlay state
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeColumnId, setActiveColumnId] = useState<ColumnId | null>(null)
  const dragStartColumnsRef = useRef<TaskColumns | null>(null)
  const dragFromColRef = useRef<ColumnId | null>(null)
  // Tracks the latest optimistic column layout during drag — updated by handleDragOver,
  // read by handleDragEnd. Using a ref avoids the stale closure problem where useCallback
  // captures an old `optimistic` value.
  const dragOptimisticRef = useRef<TaskColumns | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { columnId: string; task: Task }
    setActiveTask(data.task)
    setActiveColumnId(data.columnId as ColumnId)
    dragStartColumnsRef.current = optimistic?.columns ?? parsed.columns
    dragFromColRef.current = data.columnId as ColumnId
    dragOptimisticRef.current = null
  }, [optimistic, parsed.columns])

  // Move items between columns in state so dnd-kit can show displacement in the target column.
  // Works because sortable IDs are plain task.id (not composite), so dnd-kit tracks the
  // active item across containers.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeData = active.data.current as { columnId: string; task: Task } | undefined
    if (!activeData?.task) return
    const task = activeData.task

    const overId = String(over.id)

    // Determine target column
    let targetCol: ColumnId
    if (COLUMN_ORDER.includes(overId as ColumnId)) {
      targetCol = overId as ColumnId
    } else {
      // over.id is a task ID — get its column from the sortable data
      const overData = over.data.current as { columnId: string } | undefined
      if (overData?.columnId) {
        targetCol = overData.columnId as ColumnId
      } else {
        return
      }
    }

    setOptimistic(prev => {
      const currentColumns = prev?.columns ?? parsed.columns

      // Find which column currently holds the active task
      let currentCol: ColumnId | null = null
      for (const colId of COLUMN_ORDER) {
        if (currentColumns[colId].some(t => t.id === task.id)) {
          currentCol = colId
          break
        }
      }

      if (!currentCol || currentCol === targetCol) return prev

      // Cross-column move — remove from source, insert into target
      const fromTasks = currentColumns[currentCol].filter(t => t.id !== task.id)
      const toTasks = [...currentColumns[targetCol]]

      if (!COLUMN_ORDER.includes(overId as ColumnId)) {
        const idx = toTasks.findIndex(t => t.id === overId)
        if (idx !== -1) {
          toTasks.splice(idx, 0, task)
        } else {
          toTasks.push(task)
        }
      } else {
        toTasks.push(task)
      }

      const updated = { ...currentColumns, [currentCol]: fromTasks, [targetCol]: toTasks }
      dragOptimisticRef.current = updated
      return { columns: updated }
    })
  }, [parsed.columns])

  const handleDragCancel = useCallback(() => {
    setActiveTask(null)
    setActiveColumnId(null)
    if (dragStartColumnsRef.current) {
      setOptimistic({ columns: dragStartColumnsRef.current })
    }
    dragStartColumnsRef.current = null
    dragOptimisticRef.current = null
    setTimeout(() => setOptimistic(null), 0)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event

    setActiveTask(null)
    setActiveColumnId(null)

    const originalColumns = dragStartColumnsRef.current
    const fromCol = dragFromColRef.current
    dragStartColumnsRef.current = null
    dragFromColRef.current = null

    if (!over || !originalColumns || !fromCol) {
      setOptimistic(null)
      return
    }

    const activeData = active.data.current as { columnId: string; task: Task } | undefined
    if (!activeData?.task) {
      setOptimistic(null)
      return
    }
    const task = activeData.task

    // Determine target column from the drop event. We cannot use
    // active.data.current.columnId here — useSortable updates it live when
    // handleDragOver moves the task between columns in optimistic state, so it
    // reflects the current (target) column, not the original source column.
    // fromCol is captured at drag start via dragFromColRef.
    const overId = String(over.id)
    let targetCol: ColumnId
    if (COLUMN_ORDER.includes(overId as ColumnId)) {
      targetCol = overId as ColumnId
    } else {
      const overData = over.data.current as { columnId: string } | undefined
      if (overData?.columnId && COLUMN_ORDER.includes(overData.columnId as ColumnId)) {
        targetCol = overData.columnId as ColumnId
      } else {
        setOptimistic(null)
        return
      }
    }

    if (fromCol === targetCol) {
      // Same-column reorder — onDragOver skips same-column, compute new order here
      const colTasks = [...originalColumns[fromCol]]
      const oldIndex = colTasks.findIndex(t => t.id === task.id)
      const newIndex = !COLUMN_ORDER.includes(overId as ColumnId)
        ? colTasks.findIndex(t => t.id === overId)
        : colTasks.length - 1

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        setOptimistic(null)
        return
      }

      const reordered = arrayMove(colTasks, oldIndex, newIndex)

      setOptimistic(prev => {
        const base = prev?.columns ?? originalColumns
        return { columns: { ...base, [fromCol]: reordered } }
      })

      const ok = await apiFetch('/api/plugins/tasks/reorder', {
        columnId: fromCol,
        orderedIds: reordered.map(t => t.id),
      })

      if (!ok) toast('Failed to reorder tasks', 'error')
      await refreshTaskboard()
      setOptimistic(null)
    } else {
      // Cross-column move — determine insert position using pointer position
      // relative to the over card's midpoint. This is the same heuristic dnd-kit
      // uses internally for sortable displacement. We can't rely on handleDragOver's
      // optimistic state because dnd-kit doesn't fire onDragOver for within-column
      // movement after the initial cross-column entry.
      const movedTask = { ...task, checked: targetCol === 'done' || targetCol === 'archived' }
      const originalTargetTasks = originalColumns[targetCol]
      let insertIdx = originalTargetTasks.length // default: append

      if (!COLUMN_ORDER.includes(overId as ColumnId)) {
        // Dropped on/near a card — find it in the target column
        const idx = originalTargetTasks.findIndex(t => t.id === overId)
        if (idx !== -1) {
          // Compare pointer Y to the over card's vertical midpoint
          const pointerY = (event.activatorEvent as PointerEvent).clientY + event.delta.y
          const overRect = over.rect
          const midY = overRect.top + overRect.height / 2
          insertIdx = pointerY > midY ? idx + 1 : idx
        }
        // If overId not found (e.g. it's the dragged task), fall through to append
      }

      // Build the target column with the moved task inserted
      const targetTasks = [...originalTargetTasks]
      targetTasks.splice(insertIdx, 0, movedTask)

      const updatedColumns = { ...originalColumns }
      updatedColumns[fromCol] = originalColumns[fromCol].filter(t => t.id !== task.id)
      updatedColumns[targetCol] = targetTasks
      setOptimistic({ columns: updatedColumns })

      // Compute position neighbors for atomic move
      const afterTaskId = insertIdx > 0 ? targetTasks[insertIdx - 1]?.id : undefined
      const beforeTaskId = insertIdx + 1 < targetTasks.length ? targetTasks[insertIdx + 1]?.id : undefined

      // Blocked column requires a reason — defer the API call to the dialog
      if (targetCol === 'blocked') {
        setPendingBlock({ task, fromCol, afterTaskId, beforeTaskId })
        return // optimistic state stays until dialog confirms or cancels
      }

      // Single atomic move call — position computed server-side from neighbors
      const ok = await apiFetch('/api/plugins/tasks/' + task.id + '/move', {
        id: task.id, title: task.title, from: fromCol, to: targetCol,
        agent: 'human', channel: 'human',
        afterTaskId, beforeTaskId,
      })

      if (!ok) {
        toast(`Failed to move "${task.title}"`, 'error')
      }
      await refreshTaskboard()
      setOptimistic(null)
    }
  }, [refreshTaskboard])

  const handleAssign = useCallback(async (task: Task, agent: string) => {
    const ok = await apiFetch('/api/plugins/tasks/' + task.id + '/assign', { id: task.id, title: task.title, agent })
    if (ok) {
      await refreshTaskboard()
    } else {
      toast(`Failed to assign "${task.title}"`, 'error')
    }
  }, [])

  const [detailTask, setDetailTask] = useState<{ task: Task; columnId: ColumnId } | null>(null)
  const [editing, setEditing] = useState(false)

  // Deep link: open task from ?taskId= param (e.g. from asset detail)
  const taskIdHandled = useRef(false)
  useEffect(() => {
    if (!taskIdParam || taskIdHandled.current) return
    taskIdHandled.current = true

    for (const [colId, colTasks] of Object.entries(columns) as [ColumnId, Task[]][]) {
      const match = colTasks.find(t => t.id === taskIdParam)
      if (match) {
        setDetailTask({ task: match, columnId: colId })
        setEditing(false)
        setTaskIdParam('')
        return
      }
    }
    toast('Task not found', 'error')
    setTaskIdParam('')
  }, [taskIdParam, columns])
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  // Blocked reason dialog state — when a task is dropped on the blocked column,
  // we hold the move in a pending state until the user provides a reason.
  const [pendingBlock, setPendingBlock] = useState<{
    task: Task; fromCol: ColumnId; afterTaskId?: string; beforeTaskId?: string
  } | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const ok = await apiFetch('/api/plugins/tasks/' + deleteTarget.id, { id: deleteTarget.id, title: deleteTarget.title }, 'DELETE')
    if (ok) {
      toast(`Deleted "${deleteTarget.title}"`, 'success')
      await refreshTaskboard()
    }
    setDeleteTarget(null)
  }, [deleteTarget])

  return (
    <WithLoading>
      <div className="flex flex-col h-full min-w-0 min-h-0">
        {/* Metrics bar — hidden on mobile to save space */}
        <div className="hidden md:block px-6 pt-[25px] pb-2 border-b border-border/50">
          <TaskMetrics columns={columns} timestamp={timestamp} />
        </div>

        {/* Title row with search + view toggle */}
        <div className="px-6 pt-3 md:pt-4 pb-2">
          <PluginHeader
            title="Tasks"
            count={view === 'kanban'
              ? Object.values(filteredColumns).reduce((s, c) => s + c.length, 0)
              : allTasksFlat.length
            }
            search={{ value: search, onChange: setSearch, placeholder: 'Search tasks...' }}
            actions={
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
                  <button
                    onClick={() => setView('kanban')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      view === 'kanban'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Kanban className="size-3.5" />
                    Board
                  </button>
                  <button
                    onClick={() => setView('table')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      view === 'table'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Table2 className="size-3.5" />
                    Log
                  </button>
                </div>
                <Button size="sm" onClick={() => { setDetailTask(null); setEditing(true) }}>
                  <Plus className="size-4" />
                  New Task
                </Button>
              </div>
            }
          />
        </div>

        {/* Filters */}
        <div className="px-6 pb-3">
          <TaskFilters
            agentFilter={agentFilter}
            onAgentChange={setAgentFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            showStatusFilter={view === 'table'}
          />
        </div>

        {/* Content — kanban or table */}
        {view === 'kanban' ? (
          <div className="flex-1 overflow-auto min-h-0">
          <DndContext
            sensors={sensors}
            collisionDetection={multiContainerCollision}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="inline-flex gap-4 items-start p-[25px] pt-0 md:pl-[25px] pl-4">
              {COLUMN_ORDER.map((colId) => (
                <div key={colId} className="w-[75vw] sm:w-72 shrink-0">
                <KanbanColumn
                  id={colId}
                  tasks={colId === 'archived' ? [] : filteredColumns[colId]}
                  gateLabels={gateLabels}
                  childTaskLabels={childTaskLabels}
                  onAssign={handleAssign}
                  onDelete={setDeleteTarget}
                  onTaskClick={(task, colId) => { setDetailTask({ task, columnId: colId }); setEditing(false) }}
                  compact={colId === 'archived'}
                  totalCount={colId === 'archived' ? columns.archived.length : undefined}
                  onHeaderClick={colId === 'archived' ? () => { setView('table'); setStatusFilter(['archived']) } : undefined}
                />
                </div>
              ))}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeTask && activeColumnId ? (
                <TaskCardOverlay task={activeTask} columnId={activeColumnId} />
              ) : null}
            </DragOverlay>
          </DndContext>
          </div>
        ) : (
          <div className="flex-1 overflow-auto min-h-0 px-6 pb-[25px]">
            <TaskLogTable currentTasks={allTasksFlat} statusFilter={statusFilter} />
          </div>
        )}

        <TaskDetailDrawer
          task={detailTask?.task ?? null}
          columnId={detailTask?.columnId ?? null}
          open={editing || !!detailTask}
          editing={editing}
          onClose={() => { setDetailTask(null); setEditing(false) }}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onDelete={(task) => {
            setDetailTask(null)
            setEditing(false)
            setDeleteTarget({ id: task.id, title: task.title })
          }}
          onDuplicate={async (task) => {
            const ok = await apiFetch('/api/plugins/tasks/', {
              title: `${task.title} (copy)`,
              description: task.description || undefined,
              column: detailTask?.columnId || 'todo',
              assignee: task.agent || undefined,
              workflowId: task.workflowId || undefined,
            })
            if (ok) {
              toast(`Duplicated "${task.title}"`, 'success')
              await refreshTaskboard()
            }
          }}
        />

        <DeleteTaskDialog
          title={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />

        <BlockReasonDialog
          taskTitle={pendingBlock?.task.title ?? null}
          onConfirm={async (reason) => {
            if (!pendingBlock) return
            const { task, fromCol, afterTaskId, beforeTaskId } = pendingBlock
            setPendingBlock(null)
            const ok = await apiFetch('/api/plugins/tasks/' + task.id + '/move', {
              id: task.id, title: task.title, from: fromCol, to: 'blocked',
              agent: 'human', channel: 'human', reason,
              afterTaskId, beforeTaskId,
            })
            if (!ok) toast(`Failed to block "${task.title}"`, 'error')
            await refreshTaskboard()
            setOptimistic(null)
          }}
          onCancel={() => {
            setPendingBlock(null)
            setOptimistic(null)
          }}
        />
      </div>
    </WithLoading>
  )
}
