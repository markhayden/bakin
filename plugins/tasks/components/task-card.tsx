'use client'

import { useEffect } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import {
  Activity,
  AlertTriangle,
  Ban,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  FolderKanban,
  GitBranch,
  Palette,
  Users,
  Workflow,
  X,
} from 'lucide-react'
import { useAgent, useAgentColor, useAgentDisplayName } from '@makinbakin/sdk/hooks'
import { PluginLink } from '@makinbakin/sdk/navigation'
import {
  AgentAvatar,
  KanbanCardSignal,
  StatusBadge,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Overline,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { COLUMN_CONFIG, STATUS_TONES } from '../constants'
import { compactDispatchFailureLabel, getLatestDispatchFailure } from '../lib/dispatch-failure'
import { getTaskAvailableAtMs } from '../lib/scheduled'
import type { BudgetHold } from '../hooks/use-budget-status'
import type { BrandHold } from '../hooks/use-brand-status'
import type { LiveActivity } from '../hooks/use-live-activity'
import type { Task, ColumnId } from '../types'
import { Inline } from '@makinbakin/sdk/layout'

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

const CHILD_HIGHLIGHT_CLASSES = ['ring-2', 'ring-bakin-focus-ring', 'border-bakin-focus-ring']

/** Outline the linked child task's card (matched via data-task-id) while its sub-task signal is hovered. */
function setChildCardHighlight(childTaskId: string, on: boolean): void {
  const wrapper = document.querySelector(`[data-task-id="${CSS.escape(childTaskId)}"]`)
  const card = wrapper?.firstElementChild
  if (!card) return
  for (const cls of CHILD_HIGHLIGHT_CLASSES) card.classList.toggle(cls, on)
}

interface TaskCardContentProps {
  task: Task
  columnId: string
  className?: string
  gateLabel?: string
  childTaskId?: string
  budgetHold?: BudgetHold
  brandHold?: BrandHold
  warnUnbranded?: boolean
  scoreInfo?: TaskScoreInfo
  liveActivity?: LiveActivity
  isDragging?: boolean
  onDelete?: (task: { id: string; title: string }) => void
  onOpen?: (task: Task, columnId: ColumnId) => void
}

export function TaskCardContent({
  task,
  columnId,
  className,
  gateLabel,
  childTaskId,
  budgetHold,
  brandHold,
  warnUnbranded,
  scoreInfo,
  liveActivity,
  isDragging = false,
  onDelete,
  onOpen,
}: TaskCardContentProps) {
  const resolvedColumnId = columnId as ColumnId
  const agent = useAgent(task.agent ?? '')
  const agentDisplayName = useAgentDisplayName(task.agent ?? '')
  const agentColor = useAgentColor(task.agent ?? '')
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

  const hasMetadata = Boolean(task.workflowId || task.projectId || task.brandId || (!task.brandId && warnUnbranded && !isComplete))
  const hasFooter = Boolean(task.agent || task.team || task.date)
  const hasSignals = Boolean(
    budgetHold || gateLabel || (liveActivity && columnId === 'inProgress' && !isComplete)
      || childTaskId || task.dependsOn || task.blockedReason || dispatchFailure || brandHold
      || (isFutureScheduled && task.availableAt),
  )

  const openTask = () => onOpen?.(task, resolvedColumnId)

  return (
    <Card
      size="sm"
      className={`${className ?? ''} cursor-grab select-none transition-[border-color,box-shadow,opacity] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard hover:border-bakin-text-muted/50 active:cursor-grabbing ${
        isComplete ? 'opacity-[var(--bakin-state-opacity-disabled)]' : ''
      } ${
        isDragging ? 'ring-2 ring-bakin-focus-ring shadow-bakin-elevation-overlay' : ''
      }`}
      onClick={openTask}
    >
      <CardHeader>
        <Inline gap="dense">
          <StatusBadge tone={STATUS_TONES[resolvedColumnId]} variant="solid" size="xs">
            {COLUMN_CONFIG[resolvedColumnId].label}
          </StatusBadge>
          <Overline className="font-bakin-typography-family-mono">
            {shortId(task.id)}
          </Overline>
          {scoreInfo ? (
            <span className="flex min-w-0 flex-wrap items-center gap-bakin-2 font-bakin-typography-family-mono text-bakin-typography-size-meta">
              <span className="text-bakin-data-series-1">RRF {scoreInfo.score.toFixed(3)}</span>
              <span className="text-bakin-data-series-2">
                BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
              </span>
              <span className="text-bakin-data-series-3">
                SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
              </span>
            </span>
          ) : null}
        </Inline>

        {onDelete ? (
          <CardAction reveal="hover">
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="ghost" size="icon-xs" />}
                aria-label={`Delete ${task.title}`}
                className="text-bakin-text-muted hover:text-bakin-signal-danger"
                onClick={(event: React.MouseEvent) => {
                  event.stopPropagation()
                  onDelete({ id: task.id, title: task.title })
                }}
                onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
              >
                <X />
              </TooltipTrigger>
              <TooltipContent>Delete task</TooltipContent>
            </Tooltip>
          </CardAction>
        ) : null}

        <CardTitle
          className={`col-start-1 font-bakin-typography-weight-bold leading-snug ${
            isComplete ? 'line-through text-bakin-text-muted' : ''
          }`}
        >
          <h3>
            {onOpen ? (
              <Button
                type="button"
                variant="link"
                size="inline"
                className="font-bakin-typography-weight-bold text-bakin-text-primary"
                onClick={(event) => {
                  event.stopPropagation()
                  openTask()
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {task.title}
              </Button>
            ) : task.title}
          </h3>
        </CardTitle>

        {task.description ? (
          <CardDescription className="col-start-1 line-clamp-2">
            {task.description}
          </CardDescription>
        ) : null}
      </CardHeader>

      {hasMetadata || hasSignals ? (
        <CardContent className="grid gap-bakin-1 !px-0">
          {hasMetadata ? (
            <div className="grid min-w-0 gap-bakin-1 px-bakin-3 text-bakin-typography-size-meta text-bakin-text-muted">
              {task.workflowId ? (
                <span data-task-workflow className="flex min-w-0 items-center gap-bakin-1">
                  <Workflow aria-hidden="true" className="size-bakin-3 shrink-0" />
                  <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">Workflow</span>
                  <span className="truncate">{task.workflowId}</span>
                </span>
              ) : null}
              {task.projectId ? (
                <span className="flex min-w-0 items-center gap-bakin-1">
                  <FolderKanban aria-hidden="true" className="size-bakin-3 shrink-0" />
                  <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">Project</span>
                  <span className="truncate">{task.projectId.slice(0, 6)}</span>
                </span>
              ) : null}
              {task.brandId ? (
                <span className="flex min-w-0 items-center gap-bakin-1">
                  <Palette aria-hidden="true" className="size-bakin-3 shrink-0" />
                  <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">Brand</span>
                  <span className="truncate">{task.brandId}</span>
                </span>
              ) : null}
              {!task.brandId && warnUnbranded && !isComplete ? (
                <span className="flex min-w-0 items-center gap-bakin-1 text-bakin-signal-highlight">
                  <Palette aria-hidden="true" className="size-bakin-3 shrink-0" />
                  <span className="font-bakin-typography-weight-semibold">No brand</span>
                </span>
              ) : null}
            </div>
          ) : null}

          {budgetHold ? (
            <PluginLink
              to="/models?tab=spend"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="block min-w-0"
              aria-label="Open Models spend"
            >
              <KanbanCardSignal tone="danger" label={budgetHold.label} icon={CircleDollarSign}>
                {budgetHold.detail}
              </KanbanCardSignal>
            </PluginLink>
          ) : null}

          {gateLabel ? (
            <KanbanCardSignal tone="attention" label="Needs approval" icon={AlertTriangle}>
              {gateLabel}
            </KanbanCardSignal>
          ) : null}

          {liveActivity && columnId === 'inProgress' && !isComplete ? (
            <KanbanCardSignal
              role="status"
              aria-live="polite"
              tone="accent"
              label="Current turn"
              icon={Activity}
            >
              {liveActivity.label}
            </KanbanCardSignal>
          ) : null}

          {childTaskId ? (
            <KanbanCardSignal
              tone="accent"
              label="Sub-task in progress"
              icon={GitBranch}
              onMouseEnter={() => setChildCardHighlight(childTaskId, true)}
              onMouseLeave={() => setChildCardHighlight(childTaskId, false)}
            >
              <span className="truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                {shortId(childTaskId)} · {childTaskId.split('--').pop() || childTaskId}
              </span>
            </KanbanCardSignal>
          ) : null}

          {task.dependsOn ? (
            <KanbanCardSignal tone="attention" label="Waiting" icon={Clock3}>
              #{task.dependsOn.slice(0, 6).toUpperCase()}
            </KanbanCardSignal>
          ) : null}

          {task.blockedReason ? (
            <KanbanCardSignal tone="danger" label="Blocked" icon={Ban}>
              {task.blockedReason}
            </KanbanCardSignal>
          ) : null}

          {dispatchFailure ? (
            <KanbanCardSignal
              tone="danger"
              label={compactDispatchFailureLabel(dispatchFailure)}
              icon={AlertTriangle}
            />
          ) : null}

          {brandHold ? (
            <PluginLink
              to="/brands"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="block min-w-0"
              aria-label="Open Brands"
            >
              <KanbanCardSignal tone="attention" label="Brand unavailable" icon={Palette}>
                {brandHold.detail}
              </KanbanCardSignal>
            </PluginLink>
          ) : null}

          {isFutureScheduled && task.availableAt ? (
            <KanbanCardSignal tone="accent" label="Scheduled" icon={CalendarClock}>
              {formatWaitingLabel(task.availableAt)}
            </KanbanCardSignal>
          ) : null}
        </CardContent>
      ) : null}

      {hasFooter ? (
        <CardFooter className="justify-between gap-bakin-2">
          <span className="flex min-w-0 items-center gap-bakin-2">
            {task.agent ? (
              <AgentAvatar
                agent={{
                  id: task.agent,
                  name: agentDisplayName ?? agent?.name ?? task.agent,
                  imageSrc: agent?.headshot,
                  color: agentColor,
                }}
                size="sm"
              />
            ) : null}
            {task.team ? (
              <Badge size="xs" tone="accent" variant="outline">
                <Users />
                {task.team}
              </Badge>
            ) : null}
          </span>
          {task.date ? (
            <span className="shrink-0 text-bakin-typography-size-meta uppercase tracking-tight text-bakin-text-muted">
              {formatRelativeDate(task.date)}
            </span>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
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
      ref={ref}
      data-task-id={task.id}
      data-column-id={columnId}
      className="relative"
    >
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
        isDragging={isDragging}
        onDelete={onDelete}
        onOpen={onClick}
      />
    </div>
  )
}
