'use client'

import type { Task, ColumnId } from '../types'
import { useTaskDetail } from './use-task-detail'
import { TaskDetailForm, TaskDetailView } from './task-detail-modes'

interface TaskDetailDrawerProps {
  task: Task | null
  columnId: ColumnId | null
  open: boolean
  editing: boolean
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onDelete?: (task: Task) => void
  onDuplicate?: (task: Task) => void
}

export function TaskDetailDrawer({ task, columnId, open, editing, onClose, onEdit, onCancelEdit, onDelete, onDuplicate }: TaskDetailDrawerProps) {
  // Single hook sequence for every render path (create / edit / detail) — all
  // interlocking state lives in useTaskDetail so the mode branch below never
  // changes hook order.
  const m = useTaskDetail({ task, columnId, open, editing, onClose })

  // ─── Edit/Create Form ──────────────────────────────────────────
  if (editing) {
    return (
      <TaskDetailForm
        m={m}
        task={task}
        columnId={columnId}
        open={open}
        onClose={onClose}
        onCancelEdit={onCancelEdit}
      />
    )
  }

  // ─── Detail View ────────────────────────────────────────────────
  if (!task || !columnId) return null

  return (
    <TaskDetailView
      m={m}
      task={task}
      columnId={columnId}
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
    />
  )
}
