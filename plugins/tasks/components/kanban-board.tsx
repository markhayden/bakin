'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { KanbanColumn } from './kanban-column'
import { TaskCardOverlay } from './task-card'
import { NewTaskDialog } from './new-task-dialog'
import { DeleteTaskDialog } from './delete-task-dialog'
import { TaskDetailDrawer } from './task-detail-dialog'
import { WithLoading } from '@/components/layout/skeleton-loader'
import { useContentStore } from '@/hooks/use-content-store'
import { parseTasks } from '../parser'
import { toast } from '@/hooks/use-toast'
import { useGateStatus } from './use-gate-status'
import type { Task, TaskColumns, ColumnId } from '../types'

const COLUMN_ORDER: ColumnId[] = ['todo', 'blocked', 'inProgress', 'review', 'done', 'confirmed']

function parseCompositeId(id: string): { columnId: ColumnId; taskId: string } | null {
  const parts = String(id).split('::')
  if (parts.length !== 2) return null
  return { columnId: parts[0] as ColumnId, taskId: parts[1] }
}

async function apiFetch(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
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

/** Re-fetch TASKBOARD.md and push it into the Zustand store so the board re-renders */
async function refreshTaskboard() {
  // Wait for chokidar's stabilityThreshold (300ms) + margin before fetching
  await new Promise(r => setTimeout(r, 400))
  try {
    const res = await fetch('/api/state')
    if (res.ok) {
      const files = await res.json()
      if (files['TASKBOARD.md']) {
        useContentStore.getState().updateFile('TASKBOARD.md', files['TASKBOARD.md'])
      }
    }
  } catch { /* SSE will eventually sync */ }
}

export function KanbanBoard() {
  const files = useContentStore((s) => s.files)
  const taskboardContent = files['TASKBOARD.md'] || ''

  const parsed = useMemo(() => {
    if (!taskboardContent) return { columns: { inProgress: [], todo: [], review: [], done: [], confirmed: [], blocked: [] } as TaskColumns, timestamp: undefined }
    return parseTasks(taskboardContent)
  }, [taskboardContent])

  // Optimistic overrides — applied on top of parsed data
  const [optimistic, setOptimistic] = useState<{ columns: TaskColumns } | null>(null)
  const columns = optimistic?.columns ?? parsed.columns
  const { timestamp } = parsed

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { columnId: string; task: Task }
    setActiveTask(data.task)
    setActiveColumnId(data.columnId as ColumnId)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event

    // Clear overlay state
    setActiveTask(null)
    setActiveColumnId(null)

    if (!over) return

    const activeData = active.data.current as { columnId: string; task: Task }
    const task = activeData.task
    const fromCol = activeData.columnId as ColumnId

    // Determine target column and position
    const overId = String(over.id)
    let targetCol: ColumnId
    let overTaskId: string | null = null

    if (COLUMN_ORDER.includes(overId as ColumnId)) {
      // Dropped on the column droppable itself
      targetCol = overId as ColumnId
    } else {
      // Dropped on a task — parse composite ID
      const parsed = parseCompositeId(overId)
      if (parsed) {
        targetCol = parsed.columnId
        overTaskId = parsed.taskId
      } else {
        const overData = over.data.current as { columnId: string } | undefined
        targetCol = (overData?.columnId || overId) as ColumnId
      }
    }

    if (fromCol === targetCol) {
      // Within-column reorder
      const colTasks = [...(optimistic?.columns ?? parsed.columns)[fromCol]]
      const oldIndex = colTasks.findIndex(t => t.id === task.id)
      const newIndex = overTaskId ? colTasks.findIndex(t => t.id === overTaskId) : colTasks.length - 1

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const reordered = arrayMove(colTasks, oldIndex, newIndex)

      setOptimistic(prev => {
        const base = prev?.columns ?? parsed.columns
        return { columns: { ...base, [fromCol]: reordered } }
      })

      const ok = await apiFetch('/api/tasks/reorder', {
        columnId: fromCol,
        orderedIds: reordered.map(t => t.id),
      })

      if (!ok) {
        toast(`Failed to reorder tasks`, 'error')
      }
      await refreshTaskboard()
      setOptimistic(null)
    } else {
      // Cross-column move
      const base = optimistic?.columns ?? parsed.columns
      const fromTasks = base[fromCol].filter(t => t.id !== task.id)
      const toTasks = [...base[targetCol]]
      const movedTask = { ...task, checked: targetCol === 'done' || targetCol === 'confirmed' }

      // Insert at the correct position
      if (overTaskId) {
        const idx = toTasks.findIndex(t => t.id === overTaskId)
        if (idx !== -1) {
          toTasks.splice(idx, 0, movedTask)
        } else {
          toTasks.push(movedTask)
        }
      } else {
        toTasks.push(movedTask)
      }

      setOptimistic({
        columns: { ...base, [fromCol]: fromTasks, [targetCol]: toTasks },
      })

      const ok = await apiFetch('/api/tasks/move', {
        id: task.id, title: task.title, from: fromCol, to: targetCol, agent: 'roscoe',
      })

      if (!ok) {
        toast(`Failed to move "${task.title}"`, 'error')
      }
      await refreshTaskboard()
      setOptimistic(null)
    }
  }, [parsed.columns, optimistic])

  const handleAssign = useCallback(async (task: Task, agent: string) => {
    const ok = await apiFetch('/api/tasks/assign', { id: task.id, title: task.title, agent })
    if (ok) {
      await refreshTaskboard()
    } else {
      toast(`Failed to assign "${task.title}"`, 'error')
    }
  }, [])

  const [detailTask, setDetailTask] = useState<{ task: Task; columnId: ColumnId } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const ok = await apiFetch('/api/tasks/delete', { id: deleteTarget.id, title: deleteTarget.title })
    if (ok) {
      toast(`Deleted "${deleteTarget.title}"`, 'success')
      await refreshTaskboard()
    }
    setDeleteTarget(null)
  }, [deleteTarget])

  return (
    <WithLoading>
      <div className="flex flex-col h-full min-w-0 min-h-0">
        <div className="flex items-center justify-between px-[25px] pt-[25px] pb-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
            {timestamp && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Updated {timestamp}
              </p>
            )}
          </div>
          <NewTaskDialog />
        </div>

        <div className="flex-1 overflow-auto min-h-0">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="inline-flex gap-4 items-start p-[25px] pt-0">
            {COLUMN_ORDER.map((colId) => (
              <div key={colId} className="w-72 shrink-0">
              <KanbanColumn
                id={colId}
                tasks={columns[colId]}
                gateLabels={gateLabels}
                childTaskLabels={childTaskLabels}
                onAssign={handleAssign}
                onDelete={setDeleteTarget}
                onTaskClick={(task, colId) => setDetailTask({ task, columnId: colId })}
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

        <TaskDetailDrawer
          task={detailTask?.task ?? null}
          columnId={detailTask?.columnId ?? null}
          onClose={() => setDetailTask(null)}
        />

        <DeleteTaskDialog
          title={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </WithLoading>
  )
}
