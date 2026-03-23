'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X } from 'lucide-react'
import { AGENTS } from '@/lib/constants'
import { STATUS_BADGE_STYLES, AGENT_AVATAR_COLORS } from '../constants'
import type { Task, ColumnId } from '../types'

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays > 0 && diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase()
}

function AgentAvatar({ agent, imgError, onError }: {
  agent: { id: string; emoji: string; name: string } | undefined
  imgError: boolean
  onError: () => void
}) {
  if (!agent) return (
    <span className="size-6 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground shrink-0">?</span>
  )
  if (!imgError) return (
    <img
      src={`/headshots/${agent.id}.png`}
      alt={agent.name}
      onError={onError}
      className="size-6 rounded-full object-cover object-top ring-1 ring-zinc-700 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
    />
  )
  return (
    <span className={`size-6 rounded-full flex items-center justify-center text-xs shrink-0 ${AGENT_AVATAR_COLORS[agent.id] || 'bg-zinc-400'}`}>
      {agent.emoji}
    </span>
  )
}

/** Presentational card — used by DragOverlay */
export function TaskCardContent({ task, columnId, className, gateLabel }: { task: Task; columnId: string; className?: string; gateLabel?: string }) {
  const [imgError, setImgError] = useState(false)
  const agent = AGENTS.find((a) => a.id === task.agent)
  const badge = STATUS_BADGE_STYLES[columnId as ColumnId]

  return (
    <div className={className}>
      {/* Top: status badge + ID */}
      <div className="flex items-center gap-1.5 mb-3">
        {badge && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${badge.bg}`}>
            {badge.label}
          </span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
          {shortId(task.id)}
        </span>
      </div>

      {/* Title */}
      <h3 className={`text-[14px] font-medium leading-[1.4] mb-2 ${task.checked ? 'line-through text-muted-foreground' : 'text-zinc-100'}`}>
        {task.title}
      </h3>

      {/* Description — wraps up to 2 lines */}
      {task.description && (
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2 mb-1">
          {task.description}
        </p>
      )}

      {/* Workflow badge */}
      {task.workflowId && (
        <span className="text-xs text-blue-400/70 mt-1">⚡ {task.workflowId}</span>
      )}

      {/* Gate approval indicator */}
      {gateLabel && (
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
          <span className="text-amber-400 text-[11px] font-semibold">Awaiting Approval</span>
          <span className="text-amber-400/60 text-[10px] truncate">{gateLabel}</span>
        </div>
      )}

      {/* Dependency indicator */}
      {task.dependsOn && (
        <p className="text-xs text-amber-500/70 mt-1 pl-[18px]">waiting on #{task.dependsOn.slice(0, 6).toUpperCase()}</p>
      )}

      {/* Blocked reason */}
      {task.blockedReason && (
        <p className="text-xs text-destructive mt-1.5">{task.blockedReason}</p>
      )}

      {/* Footer: avatar bottom-left, date right */}
      <div className="flex items-center justify-between mt-4">
        <AgentAvatar agent={agent} imgError={imgError} onError={() => setImgError(true)} />
        {task.date && (
          <span className="text-zinc-500 text-[11px] font-medium tracking-tight uppercase">
            {formatRelativeDate(task.date)}
          </span>
        )}
      </div>
    </div>
  )
}

interface TaskCardProps {
  task: Task
  columnId: string
  gateLabel?: string
  onAssign: (task: Task, agent: string) => void
  onDelete: (task: { id: string; title: string }) => void
  onClick: (task: Task, columnId: ColumnId) => void
}

export function TaskCard({ task, columnId, gateLabel, onAssign, onDelete, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${columnId}::${task.id}`,
    data: { task, columnId },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
  }

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="w-full min-h-[80px] rounded-xl border-2 border-dashed border-blue-500/50 bg-blue-500/5 animate-pulse"
      />
    )
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        onClick={() => onClick(task, columnId as ColumnId)}
        className={`group relative rounded-xl border border-border bg-card cursor-grab active:cursor-grabbing hover:border-zinc-700 hover:shadow-sm shadow-sm shadow-black/20 select-none ${
          task.checked ? 'opacity-60' : ''
        } ${task.blockedReason ? 'border-l-2 border-l-destructive' : ''}`}
      >
      {/* Delete button — top-right, shows on hover */}
      <button
        className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive z-10"
        onClick={(e) => { e.stopPropagation(); onDelete({ id: task.id, title: task.title }) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <X className="size-3.5" />
      </button>

      <TaskCardContent
        task={task}
        columnId={columnId}
        gateLabel={gateLabel}
        className="p-4"
      />
      </div>
    </div>
  )
}

/** Lightweight overlay card rendered in DragOverlay — no sortable hooks */
export function TaskCardOverlay({ task, columnId }: { task: Task; columnId: ColumnId }) {
  return (
    <TaskCardContent
      task={task}
      columnId={columnId}
      className={`w-72 rounded-xl border border-border bg-card p-4 shadow-2xl ring-1 ring-border scale-105 ${
        task.blockedReason ? 'border-l-2 border-l-destructive' : ''
      }`}
    />
  )
}
