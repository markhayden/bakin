'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { AGENTS } from '@/lib/constants'
import type { Task, ColumnId } from '@/types'

interface TaskCardProps {
  task: Task
  columnId: string
  onAssign: (title: string, agent: string) => void
  onDelete: (title: string) => void
  onClick: (task: Task, columnId: ColumnId) => void
}

export function TaskCard({ task, columnId, onAssign, onDelete, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${columnId}::${task.title}`,
    data: { task, columnId },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const agent = AGENTS.find((a) => a.id === task.agent)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task, columnId as ColumnId)}
      className={`group rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing transition-all duration-150 hover:border-[rgba(255,255,255,0.15)] ${
        isDragging ? 'opacity-50' : ''
      } ${task.checked ? 'opacity-60' : ''} ${
        task.blockedReason ? 'border-l-2 border-l-destructive' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`text-sm leading-snug ${
            task.checked ? 'line-through text-muted-foreground' : 'text-foreground'
          }`}
        >
          {task.title}
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
          onClick={(e) => { e.stopPropagation(); onDelete(task.title) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {task.blockedReason && (
        <p className="text-xs text-destructive mt-1.5">
          {task.blockedReason}
        </p>
      )}

      {task.log && task.log.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1.5 truncate">
          <span className="font-mono text-[10px] opacity-60">{task.log[task.log.length - 1].author}:</span>{' '}
          {task.log[task.log.length - 1].message}
        </p>
      )}

      <div className="flex items-center gap-2 mt-2">
        {agent && (
          <Badge variant="secondary" className="text-xs font-mono gap-1 px-1.5 py-0">
            <span>{agent.emoji}</span>
            <span>{agent.name}</span>
          </Badge>
        )}
        {!agent && (
          <select
            className="text-xs bg-transparent text-muted-foreground border-none outline-none cursor-pointer"
            value=""
            onChange={(e) => {
              e.stopPropagation()
              onAssign(task.title, e.target.value)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <option value="">Unassigned</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
        )}
        {agent && (
          <select
            className="text-xs bg-transparent text-muted-foreground border-none outline-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            value={task.agent || ''}
            onChange={(e) => {
              e.stopPropagation()
              onAssign(task.title, e.target.value)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <option value="">Unassign</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
        )}
        {task.date && (
          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {task.date}
          </span>
        )}
      </div>
    </div>
  )
}
