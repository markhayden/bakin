'use client'

import { useCallback, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { KanbanColumn } from './kanban-column'
import { NewTaskDialog } from './new-task-dialog'
import { DeleteTaskDialog } from './delete-task-dialog'
import { TaskDetailDrawer } from './task-detail-dialog'
import { useContentStore } from '@/hooks/use-content-store'
import { parseTasks } from '@/lib/parsers/tasks'
import type { Task, ColumnId } from '@/types'

const COLUMN_ORDER: ColumnId[] = ['todo', 'blocked', 'inProgress', 'done']

export function KanbanBoard() {
  const files = useContentStore((s) => s.files)
  const taskboardContent = files['TASKBOARD.md'] || ''
  const { columns, timestamp } = parseTasks(taskboardContent)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const activeData = active.data.current as { columnId: string }
    const overId = String(over.id)

    // Determine target column: either the column itself or the column of the card we're over
    let targetCol: string
    if (COLUMN_ORDER.includes(overId as ColumnId)) {
      targetCol = overId
    } else {
      const overData = over.data.current as { columnId: string } | undefined
      targetCol = overData?.columnId || overId
    }

    if (activeData.columnId === targetCol) return

    const title = (active.data.current as { task: { title: string } }).task.title

    await fetch('/api/tasks/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, from: activeData.columnId, to: targetCol }),
    })
  }, [])

  const handleAssign = useCallback(async (title: string, agent: string) => {
    await fetch('/api/tasks/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, agent }),
    })
  }, [])

  const [detailTask, setDetailTask] = useState<{ task: Task; columnId: ColumnId } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    await fetch('/api/tasks/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: deleteTarget }),
    })
    setDeleteTarget(null)
  }, [deleteTarget])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMN_ORDER.map((colId) => (
            <KanbanColumn
              key={colId}
              id={colId}
              tasks={columns[colId]}
              onAssign={handleAssign}
              onDelete={setDeleteTarget}
              onTaskClick={(task, colId) => setDetailTask({ task, columnId: colId })}
            />
          ))}
        </div>
      </DndContext>

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
  )
}
