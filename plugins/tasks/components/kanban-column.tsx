'use client'

import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import { TaskCard } from './task-card'
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { Task, ColumnId } from '../types'

interface KanbanColumnProps {
  id: ColumnId
  tasks: Task[]
  gateLabels?: Record<string, string>
  childTaskLabels?: Record<string, string>
  onAssign: (task: Task, agent: string) => void
  onDelete: (task: { id: string; title: string }) => void
  onTaskClick: (task: Task, columnId: ColumnId) => void
  onAddTask?: (columnId: ColumnId) => void
  footer?: React.ReactNode
  compact?: boolean
  totalCount?: number
  onHeaderClick?: () => void
}

export function KanbanColumn({ id, tasks, gateLabels, childTaskLabels, onAssign, onDelete, onTaskClick, onAddTask, footer, compact, totalCount, onHeaderClick }: KanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({
    id,
    accept: 'item',
    collisionPriority: CollisionPriority.Low,
    data: { group: id, columnId: id },
  })
  const config = COLUMN_CONFIG[id]
  const dotColor = STATUS_DOT_COLORS[id]

  const count = totalCount ?? tasks.length

  if (compact) {
    const isArchiveTarget = id === 'archived' && isDropTarget

    return (
      <div className="flex flex-col">
        <div
          ref={ref}
          data-drop-target={isArchiveTarget || undefined}
          className={`flex flex-col min-h-[80px] rounded-lg border border-dashed p-3 cursor-pointer transition-colors ${
            isArchiveTarget
              ? 'bg-[color:color-mix(in_oklab,var(--accent)_10%,var(--surface))] border-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]'
              : 'border-border bg-surface/50 hover:bg-surface'
          }`}
          onClick={onHeaderClick}
        >
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
            <span className="text-sm font-medium text-foreground">{config.label}</span>
            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded-full tabular-nums leading-none ${
              isArchiveTarget ? 'text-[var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_14%,transparent)]' : 'text-muted-foreground bg-muted/50'
            }`}>
              {count}
            </span>
          </div>
          <div
            className={`mt-3 rounded-md border border-dashed px-3 py-3.5 text-xs ${
              isArchiveTarget
                ? 'border-[color:color-mix(in_oklab,var(--accent)_60%,transparent)] bg-[color:color-mix(in_oklab,var(--accent)_8%,transparent)] text-[var(--accent)] font-medium'
                : 'border-border/80 bg-muted/20 text-muted-foreground'
            }`}
          >
            {isArchiveTarget ? 'Release to archive' : 'Drop here to archive'}
          </div>
          {onHeaderClick ? (
            <button
              type="button"
              className="mt-3 self-center cursor-pointer text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onHeaderClick()
              }}
            >
              View archived items
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div
        ref={ref}
        className="flex flex-col min-h-[200px] rounded-lg border border-border bg-surface p-3"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
            <span className="text-sm font-medium text-foreground">{config.label}</span>
            <span className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full tabular-nums leading-none">
              {count}
            </span>
          </div>
          {onAddTask && (
            <button
              onClick={() => onAddTask(id)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 -mr-2 rounded-md hover:bg-muted/50"
            >
              + Add
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          {tasks.map((task, index) => (
            <div key={task.id}>
              <TaskCard
                task={task}
                columnId={id}
                index={index}
                gateLabel={gateLabels?.[task.id]}
                childTaskId={childTaskLabels?.[task.id]}
                onAssign={onAssign}
                onDelete={onDelete}
                onClick={onTaskClick}
              />
            </div>
          ))}
        </div>
      </div>
      {footer && (
        <div className="flex justify-center mt-2">
          {footer}
        </div>
      )}
    </div>
  )
}
