'use client'

import { useEffect, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { AlertTriangle, Users, X } from 'lucide-react'
import { AgentAvatar, PluginLink } from "@makinbakin/sdk/components"
import { STATUS_BADGE_STYLES } from '../constants'
import { compactDispatchFailureLabel, getLatestDispatchFailure } from '../lib/dispatch-failure'
import { getTaskAvailableAtMs } from '../lib/scheduled'
import type { BudgetHold } from '../hooks/use-budget-status'
import type { BrandHold } from '../hooks/use-brand-status'
import type { LiveActivity } from '../hooks/use-live-activity'
import type { Task, ColumnId } from '../types'

export interface TaskScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

function formatRelativeDate(dateStr: string): string {
  // Parse YYYY-MM-DD as local date, not UTC (appending T00:00 forces local interpretation)
  const date = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00')
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

function formatWaitingLabel(dateStr: string): string {
  const date = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00')
  if (isNaN(date.getTime())) return `Waiting until ${dateStr}`

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000)
  const hasTime = dateStr.includes('T') && (date.getHours() !== 0 || date.getMinutes() !== 0)
  const time = hasTime
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase()
    : ''

  let day: string
  if (diffDays === 0) day = 'today'
  else if (diffDays === 1) day = 'tomorrow'
  else if (diffDays > 1 && diffDays < 7) day = date.toLocaleDateString('en-US', { weekday: 'short' })
  else day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return time ? `Waiting till after ${day}, ${time}` : `Waiting until ${day}`
}

function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase()
}

const CHILD_HIGHLIGHT_CLASSES = ['ring-2', 'ring-cyan-400/60', 'border-cyan-400/60']

/** Outline the linked child task's card (matched via data-task-id) while the sub-task badge is hovered. */
function setChildCardHighlight(childTaskId: string, on: boolean): void {
  const wrapper = document.querySelector(`[data-task-id="${CSS.escape(childTaskId)}"]`)
  const card = wrapper?.firstElementChild
  if (!card) return
  for (const cls of CHILD_HIGHLIGHT_CLASSES) card.classList.toggle(cls, on)
}

export function TaskCardContent({ task, columnId, className, gateLabel, childTaskId, budgetHold, brandHold, warnUnbranded, style, scoreInfo, liveActivity }: { task: Task; columnId: string; className?: string; gateLabel?: string; childTaskId?: string; budgetHold?: BudgetHold; brandHold?: BrandHold; warnUnbranded?: boolean; style?: CSSProperties; scoreInfo?: TaskScoreInfo; liveActivity?: LiveActivity }) {
  const badge = STATUS_BADGE_STYLES[columnId as ColumnId]
  // Clear any lingering child-card outline if this card unmounts mid-hover
  // (e.g. the sub-task finishes and the badge disappears under the cursor).
  useEffect(() => {
    if (!childTaskId) return
    return () => setChildCardHighlight(childTaskId, false)
  }, [childTaskId])
  const isComplete = task.checked || columnId === 'done' || columnId === 'archived'
  const availableAtMs = getTaskAvailableAtMs(task)
  const isFutureScheduled = availableAtMs !== null && availableAtMs > Date.now()
  const dispatchFailure = getLatestDispatchFailure(task.log)

  const semKey = 'embeddings'
  const bm25Key = scoreInfo?.indexScores
    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
    : undefined

  return (
    <div className={className} style={style}>
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
        {scoreInfo && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
            <span className="text-cyan-400">
              BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
            </span>
            <span className="text-purple-400">
              SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
            </span>
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className={`text-[14px] font-medium leading-[1.4] mb-2 ${isComplete ? 'line-through text-muted-foreground' : 'text-zinc-100'}`}>
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

      {/* Project badge */}
      {task.projectId && (
        <span className="inline-flex items-center gap-1 text-[10px] text-violet-400/70 mt-1">
          <span className="size-2 rounded-sm bg-violet-500/30" />
          {task.projectId.slice(0, 6)}
        </span>
      )}

      {/* Brand badge (#419) — plus an opt-in nudge for unbranded work */}
      {task.brandId && (
        <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-400/80 mt-1">
          <span className="size-2 rounded-full bg-fuchsia-500/40" />
          {task.brandId}
        </span>
      )}
      {!task.brandId && warnUnbranded && !isComplete && (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/60 mt-1" title="warnUnbranded is on — this task has no brand">
          <span className="size-2 rounded-full border border-amber-500/40" />
          no brand
        </span>
      )}

      {/* Budget-deferred indicator (cost-control v2): the task is eligible
          but the spend gate is holding it — visibly, never silently. */}
      {budgetHold && (
        <PluginLink
          to="/models?tab=spend"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 whitespace-nowrap overflow-hidden hover:bg-red-500/20"
          title="Open Models → Spend"
        >
          <span className="text-red-400 text-[11px] font-semibold shrink-0">{budgetHold.label}</span>
          <span className="text-red-400/60 text-[10px] truncate">{budgetHold.detail}</span>
        </PluginLink>
      )}

      {/* Gate approval indicator */}
      {gateLabel && (
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 whitespace-nowrap overflow-hidden">
          <span className="text-amber-400 text-[11px] font-semibold shrink-0">Needs Approval</span>
          <span className="text-amber-400/60 text-[10px] truncate">{gateLabel}</span>
        </div>
      )}

      {/* Live turn activity (ephemeral SSE chip): only meaningful while the
          turn runs, so inProgress only — TTL in the hook sweeps stale chips. */}
      {liveActivity && columnId === 'inProgress' && !isComplete && (
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 whitespace-nowrap overflow-hidden">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
          <span className="text-blue-300 text-[11px] truncate" title={liveActivity.label}>{liveActivity.label}</span>
        </div>
      )}

      {/* Child sub-task indicator — hover outlines the linked child card */}
      {childTaskId && (
        <div
          className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 whitespace-nowrap overflow-hidden"
          title={childTaskId}
          onMouseEnter={() => setChildCardHighlight(childTaskId, true)}
          onMouseLeave={() => setChildCardHighlight(childTaskId, false)}
        >
          <span className="text-cyan-400 text-[11px] shrink-0">Sub-task in progress</span>
          <span className="text-cyan-400/60 text-[10px] font-mono truncate">
            {shortId(childTaskId)} · {childTaskId.split('--').pop() || childTaskId}
          </span>
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

      {dispatchFailure && (
        <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 overflow-hidden">
          <AlertTriangle className="size-3 text-amber-400 shrink-0" />
          <span className="text-amber-300 text-[11px] font-semibold truncate">
            {compactDispatchFailureLabel(dispatchFailure)}
          </span>
        </div>
      )}

      {/* Brand-blocked indicator (#419): the task is eligible but its brand
          is missing/draft — visibly deferring, never silently. */}
      {brandHold && (
        <PluginLink
          to="/brands"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 whitespace-nowrap overflow-hidden hover:bg-amber-500/20"
          title="Open Brands"
        >
          <span className="text-amber-400 text-[11px] font-semibold shrink-0">Brand unavailable</span>
          <span className="text-amber-400/60 text-[10px] truncate">{brandHold.detail}</span>
        </PluginLink>
      )}

      {isFutureScheduled && task.availableAt && (
        <div className="mt-2 inline-flex items-center rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-300">
          {formatWaitingLabel(task.availableAt)}
        </div>
      )}

      {/* Footer: avatar bottom-left, date right. A team task shows a team
          chip until dispatch resolves it, then avatar + small chip (#189). */}
      <div className="flex items-center justify-between mt-4">
        <span className="flex items-center gap-1.5">
          {task.agent && <AgentAvatar agentId={task.agent} size="sm" />}
          {task.team && (
            <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-medium text-violet-300">
              <Users className="size-3" />
              {task.team}
            </span>
          )}
        </span>
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
  index?: number
  gateLabel?: string
  childTaskId?: string
  budgetHold?: BudgetHold
  brandHold?: BrandHold
  warnUnbranded?: boolean
  scoreInfo?: TaskScoreInfo
  liveActivity?: LiveActivity
  onDelete: (task: { id: string; title: string }) => void
  onClick: (task: Task, columnId: ColumnId) => void
}

export function TaskCard({ task, columnId, index = 0, gateLabel, childTaskId, budgetHold, brandHold, warnUnbranded, scoreInfo, liveActivity, onDelete, onClick }: TaskCardProps) {
  const { ref, isDragging } = useSortable({
    id: task.id,
    group: columnId,
    accept: 'item',
    type: 'item',
    feedback: 'clone',
    index,
    data: { group: columnId, columnId, task },
  })

  return (
    <div
      ref={ref as never}
      data-task-id={task.id}
      data-column-id={columnId}
    >
      <div
        onClick={() => onClick(task, columnId as ColumnId)}
        style={isDragging ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent), 0 24px 48px rgba(0, 0, 0, 0.35)' } : undefined}
        className={`group relative rounded-xl border border-border bg-card cursor-grab active:cursor-grabbing hover:border-zinc-700 hover:shadow-sm shadow-sm shadow-black/20 select-none ${
          task.checked || columnId === 'done' || columnId === 'archived' ? 'opacity-60' : ''
        } ${task.blockedReason ? 'border-l-2 border-l-destructive' : ''} ${
          isDragging ? 'ring-1 ring-[var(--accent)]/30' : ''
        }`}
      >
      {/* Delete button — top-right, shows on hover */}
      <button
        className="absolute top-2.5 right-2.5 p-1 rounded-md opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 z-10"
        onClick={(e) => { e.stopPropagation(); onDelete({ id: task.id, title: task.title }) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <X className="size-3.5" />
      </button>

      <TaskCardContent
        task={task}
        columnId={columnId}
        gateLabel={gateLabel}
        childTaskId={childTaskId}
        budgetHold={budgetHold}
        brandHold={brandHold}
        warnUnbranded={warnUnbranded}
        scoreInfo={scoreInfo}
        liveActivity={liveActivity}
        className="p-4"
      />
      </div>
    </div>
  )
}
