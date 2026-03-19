'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TaskCard } from './task-card'
import { COLUMN_CONFIG } from '@/lib/constants'
import type { Task, ColumnId } from '@/types'

interface KanbanColumnProps {
  id: ColumnId
  tasks: Task[]
  onAssign: (title: string, agent: string) => void
  onDelete: (title: string) => void
  onTaskClick: (task: Task, columnId: ColumnId) => void
}

export function KanbanColumn({ id, tasks, onAssign, onDelete, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const config = COLUMN_CONFIG[id]

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-h-[200px] rounded-lg border border-border bg-surface p-3 transition-colors duration-150 ${
        isOver ? 'drag-over' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{config.emoji}</span>
          <span className="text-sm font-medium text-foreground">{config.label}</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
      </div>

      <SortableContext
        items={tasks.map((t) => `${id}::${t.title}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-1.5 flex-1">
          {tasks.map((task) => (
            <TaskCard
              key={task.title}
              task={task}
              columnId={id}
              onAssign={onAssign}
              onDelete={onDelete}
              onClick={onTaskClick}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}
