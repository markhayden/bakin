'use client'

import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import {
  KanbanColumn as KanbanLane,
  KanbanColumnBody as KanbanLaneBody,
  KanbanColumnEmpty as KanbanLaneEmpty,
  KanbanColumnHeader as KanbanLaneHeader,
} from '@makinbakin/sdk/patterns'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { Plus } from 'lucide-react'
import { TaskCard, type TaskScoreInfo } from './task-card'
import { COLUMN_CONFIG } from '../constants'
import { splitScheduledTasks } from '../lib/scheduled'
import type { BudgetHold } from '../hooks/use-budget-status'
import type { BrandHold } from '../hooks/use-brand-status'
import type { LiveActivity } from '../hooks/use-live-activity'
import type { Task, ColumnId } from '../types'

interface KanbanColumnProps {
  id: ColumnId
  tasks: Task[]
  gateLabels?: Record<string, string>
  childTaskLabels?: Record<string, string>
  budgetHolds?: Record<string, BudgetHold>
  brandHolds?: Record<string, BrandHold>
  liveActivity?: Record<string, LiveActivity>
  warnUnbranded?: boolean
  /** Per-task search score info, keyed by task id. Only set when debug + active search. */
  scoreMap?: Map<string, TaskScoreInfo>
  onDelete: (task: { id: string; title: string }) => void
  onTaskClick: (task: Task, columnId: ColumnId) => void
  onAddTask?: (columnId: ColumnId) => void
  footer?: React.ReactNode
  compact?: boolean
  totalCount?: number
  showScheduled?: boolean
  onHeaderClick?: () => void
}

export function KanbanColumn({ id, tasks, gateLabels, childTaskLabels, budgetHolds, brandHolds, liveActivity, warnUnbranded, scoreMap, onDelete, onTaskClick, onAddTask, footer, compact, totalCount, showScheduled = true, onHeaderClick }: KanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({
    id,
    accept: 'item',
    collisionPriority: CollisionPriority.Low,
    data: { group: id, columnId: id },
  })
  const config = COLUMN_CONFIG[id]

  const { ready, scheduled } = splitScheduledTasks(tasks)
  const count = totalCount ?? (showScheduled ? tasks.length : ready.length)
  const countLabel = `${count} task${count === 1 ? '' : 's'}`

  if (compact) {
    const isArchiveTarget = id === 'archived' && isDropTarget

    return (
      <div className="flex flex-col">
        <div ref={ref} data-task-drop-surface className="flex flex-col">
          <KanbanLane label={config.label}>
            <KanbanLaneHeader>
              <h2 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">
                {config.label}
              </h2>
              <Badge size="xs" variant="outline" aria-label={countLabel}>{count}</Badge>
            </KanbanLaneHeader>
            <KanbanLaneBody dropTarget={isArchiveTarget}>
              <Button
                type="button"
                variant={isArchiveTarget ? 'accent' : 'outline'}
                size="sm"
                className="h-auto min-h-bakin-8 w-full whitespace-normal border-dashed"
                onClick={onHeaderClick}
              >
                {isArchiveTarget ? 'Release to archive' : 'Drop here to archive'}
              </Button>
              {onHeaderClick ? (
                <Button type="button" variant="link" size="xs" className="self-center" onClick={onHeaderClick}>
                  View archived items
                </Button>
              ) : null}
            </KanbanLaneBody>
          </KanbanLane>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div
        ref={ref}
        data-task-drop-surface
        className="flex flex-col"
      >
        <KanbanLane label={config.label}>
          <KanbanLaneHeader>
            <div className="flex min-w-0 items-center gap-bakin-2">
              <h2 className="m-0 truncate text-bakin-typography-size-body font-bakin-typography-weight-semibold">
                {config.label}
              </h2>
              <Badge size="xs" variant="outline" aria-label={countLabel}>{count}</Badge>
            </div>
            {onAddTask ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => onAddTask(id)}>
                <Plus />
                Add
              </Button>
            ) : null}
          </KanbanLaneHeader>

          <KanbanLaneBody>
            {ready.length === 0 ? (
              <KanbanLaneEmpty>No tasks</KanbanLaneEmpty>
            ) : ready.map((task) => (
              <div key={task.id}>
                <TaskCard
                  task={task}
                  columnId={id}
                  index={tasks.findIndex(item => item.id === task.id)}
                  gateLabel={gateLabels?.[task.id]}
                  childTaskId={childTaskLabels?.[task.id]}
                  budgetHold={budgetHolds?.[task.id]}
                  brandHold={brandHolds?.[task.id]}
                  liveActivity={liveActivity?.[task.id]}
                  warnUnbranded={warnUnbranded}
                  scoreInfo={scoreMap?.get(task.id)}
                  onDelete={onDelete}
                  onClick={onTaskClick}
                />
              </div>
            ))}

            {showScheduled && scheduled.length > 0 ? (
              <section aria-labelledby={`${id}-scheduled-heading`} className="mt-bakin-2 grid gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-3">
                <div className="flex min-w-0 items-center justify-between gap-bakin-2">
                  <h3
                    id={`${id}-scheduled-heading`}
                    className="m-0 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted"
                  >
                    Scheduled
                  </h3>
                  <Badge
                    size="xs"
                    variant="outline"
                    aria-label={`${scheduled.length} scheduled task${scheduled.length === 1 ? '' : 's'}`}
                  >
                    {scheduled.length}
                  </Badge>
                </div>
                {scheduled.map((task) => (
                  <div key={task.id}>
                    <TaskCard
                      task={task}
                      columnId={id}
                      index={tasks.findIndex(item => item.id === task.id)}
                      gateLabel={gateLabels?.[task.id]}
                      childTaskId={childTaskLabels?.[task.id]}
                      budgetHold={budgetHolds?.[task.id]}
                      brandHold={brandHolds?.[task.id]}
                      liveActivity={liveActivity?.[task.id]}
                      warnUnbranded={warnUnbranded}
                      scoreInfo={scoreMap?.get(task.id)}
                      onDelete={onDelete}
                      onClick={onTaskClick}
                    />
                  </div>
                ))}
              </section>
            ) : null}
          </KanbanLaneBody>
        </KanbanLane>
      </div>
      {footer && (
        <div className="flex justify-center">
          {footer}
        </div>
      )}
    </div>
  )
}
