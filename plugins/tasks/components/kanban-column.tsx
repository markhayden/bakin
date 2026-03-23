'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TaskCard } from './task-card'
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { Task, ColumnId } from '../types'

interface KanbanColumnProps {
  id: ColumnId
  tasks: Task[]
  gateLabels?: Record<string, string>
  onAssign: (task: Task, agent: string) => void
  onDelete: (task: { id: string; title: string }) => void
  onTaskClick: (task: Task, columnId: ColumnId) => void
  onAddTask?: (columnId: ColumnId) => void
}

export function KanbanColumn({ id, tasks, gateLabels, onAssign, onDelete, onTaskClick, onAddTask }: KanbanColumnProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id })
  const config = COLUMN_CONFIG[id]
  const dotColor = STATUS_DOT_COLORS[id]
  const showEmptyPlaceholder = isOver && !!active && tasks.length === 0

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col min-h-[200px] rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
          <span className="text-sm font-medium text-foreground">{config.label}</span>
          <span className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full tabular-nums leading-none">
            {tasks.length}
          </span>
        </div>
        {onAddTask && (
          <button
            onClick={() => onAddTask(id)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      <SortableContext
        items={tasks.map((t) => `${id}::${t.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-1.5 flex-1">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columnId={id}
              gateLabel={gateLabels?.[task.id]}
              onAssign={onAssign}
              onDelete={onDelete}
              onClick={onTaskClick}
            />
          ))}
          {showEmptyPlaceholder && (
            <div className="w-full min-h-[80px] rounded-xl border-2 border-dashed border-blue-500/50 bg-blue-500/5 animate-pulse" />
          )}
        </div>
      </SortableContext>
    </div>
  )
}
