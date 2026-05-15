'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/dom'
import { move } from '@dnd-kit/helpers'
import { DragDropProvider, type DragDropEventHandlers } from '@dnd-kit/react'
import { usePathname, useRouter, useSearchParams } from '@bakin/sdk/hooks'
import { KanbanColumn } from './kanban-column'
import { DeleteTaskDialog } from './delete-task-dialog'
import { BlockReasonDialog } from './block-reason-dialog'
import { TaskDetailDrawer } from './task-detail-dialog'
import { TaskMetrics } from './task-metrics'
import { PluginHeader } from "@bakin/sdk/components"
import { TaskFilters } from './task-filters'
import { TaskLogTable } from './task-log-table'
import { filterBoardColumns, useTaskFilters } from '../hooks/use-task-filters'
import { countVisibleTasks } from '../lib/scheduled'
import { useContentStore } from "@bakin/sdk/hooks"
import { useDebug } from "@bakin/sdk/hooks"
import { useQueryState, useQueryArrayState } from "@bakin/sdk/hooks"
import { toast } from "@bakin/sdk/hooks"
import { useGateStatus } from '../hooks/use-gate-status'
import { Button, Skeleton } from "@bakin/sdk/ui"
import { Kanban, Table2, Plus } from 'lucide-react'
import type { TaskScoreInfo } from './task-card'
import type { Task, TaskColumns, ColumnId } from '../types'

const COLUMN_ORDER: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived']

const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.element, source.handle]
    },
  }),
  KeyboardSensor,
]

async function apiFetch(url: string, body: Record<string, unknown>, method = 'POST'): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }))
      toast(data.error || `Request failed (${res.status})`, 'error')
      return false
    }
    return true
  } catch {
    toast('Network error — server may be down', 'error')
    return false
  }
}

const emptyBoard: TaskColumns = { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] }

function findTaskColumn(columns: TaskColumns, taskId: string): ColumnId | null {
  for (const colId of COLUMN_ORDER) {
    if (columns[colId].some(task => task.id === taskId)) return colId
  }
  return null
}

function areTaskOrdersEqual(a: TaskColumns, b: TaskColumns): boolean {
  return COLUMN_ORDER.every(colId => {
    const left = a[colId]
    const right = b[colId]

    return left.length === right.length && left.every((task, index) => task.id === right[index]?.id)
  })
}

function normalizeColumns(columns: TaskColumns): TaskColumns {
  return Object.fromEntries(
    COLUMN_ORDER.map((colId) => [
      colId,
      columns[colId].map((task) => {
        const checked = colId === 'done' || colId === 'archived'
        return task.checked === checked ? task : { ...task, checked }
      }),
    ])
  ) as unknown as TaskColumns
}

function applyMove(columns: TaskColumns, event: unknown): TaskColumns {
  return normalizeColumns(
    move(columns as unknown as Record<string, Task[]>, event as never) as unknown as TaskColumns
  )
}

function mergeVisibleColumns(
  fullColumns: TaskColumns,
  currentVisibleColumns: TaskColumns,
  nextVisibleColumns: TaskColumns,
): TaskColumns {
  return normalizeColumns(
    Object.fromEntries(
      COLUMN_ORDER.map((colId) => {
        const visibleIds = new Set(currentVisibleColumns[colId].map((task) => task.id))
        const nextVisibleTasks = [...nextVisibleColumns[colId]]
        const merged: Task[] = []
        let lastVisibleIndex = -1

        for (const task of fullColumns[colId]) {
          if (!visibleIds.has(task.id)) {
            merged.push(task)
            continue
          }

          const nextVisibleTask = nextVisibleTasks.shift()
          if (nextVisibleTask) {
            merged.push(nextVisibleTask)
            lastVisibleIndex = merged.length - 1
          }
        }

        if (nextVisibleTasks.length > 0) {
          const insertAt = lastVisibleIndex === -1 ? merged.length : lastVisibleIndex + 1
          merged.splice(insertAt, 0, ...nextVisibleTasks)
        }

        return [colId, merged]
      }),
    ) as unknown as TaskColumns
  )
}

export function KanbanBoard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [boardData, setBoardData] = useState<{ columns: TaskColumns; timestamp?: string }>({ columns: emptyBoard })
  const taskboardVersion = useContentStore((s) => s.taskboardVersion)
  const loading = useContentStore((s) => s.loading)

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/tasks/')
      if (res.ok) {
        const data = await res.json()
        setBoardData({ columns: data.columns ?? emptyBoard, timestamp: data.timestamp })
      }
    } catch { /* SSE will eventually re-trigger */ }
  }, [])

  useEffect(() => { fetchBoard() }, [fetchBoard, taskboardVersion])

  const refreshTaskboard = useCallback(async () => {
    await fetchBoard()
  }, [fetchBoard])

  const parsed = boardData
  const [optimistic, setOptimistic] = useState<{ columns: TaskColumns } | null>(null)
  const columns = optimistic?.columns ?? parsed.columns
  const { timestamp } = parsed

  const [view, setView] = useQueryState('view', 'kanban')
  const [search, setSearch] = useQueryState('q', '')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [scheduledView, setScheduledView] = useQueryState('scheduled', 'show')
  const [statusFilter, setStatusFilter] = useQueryArrayState('status')
  const showScheduled = scheduledView !== 'hide'

  const displayColumns = useMemo(() => {
    if (view === 'table') return columns
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return {
      ...columns,
      archived: columns.archived.filter(t => {
        if (!t.date) return true
        const d = new Date(t.date.includes('T') ? t.date : t.date + 'T00:00')
        return d.getTime() >= cutoff
      }),
    }
  }, [columns, view])

  const [taskIdParam, setTaskIdParam] = useQueryState('taskId', '')
  const hasBoardFilters = Boolean(search) || agentFilter !== 'all'

  const { filteredColumns, allTasksFlat, aggregations, searchResults } = useTaskFilters(displayColumns, {
    search, agentFilter, statusFilter,
  })

  const [debug] = useDebug()

  // Per-task search score map for the debug overlay. Tasks register their
  // search key as the raw `task.id` (see `plugins/tasks/index.ts` reindex
  // generator), so no prefix to strip. Only build/pass when debug is on AND
  // there's an active search query — the map is undefined otherwise so
  // TaskCardContent skips the overlay entirely.
  const scoreMap = useMemo(() => {
    if (!debug || !search.trim() || !searchResults.length) return undefined
    const map = new Map<string, TaskScoreInfo>()
    for (const r of searchResults) {
      map.set(r.id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [debug, search, searchResults])

  const workflowTaskIds = useMemo(() => {
    const ids: string[] = []
    for (const col of Object.values(columns)) {
      for (const task of col) {
        if (task.workflowId) ids.push(task.id)
      }
    }
    return ids
  }, [columns])
  const gateStatuses = useGateStatus(workflowTaskIds)

  const gateLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [taskId, status] of Object.entries(gateStatuses)) {
      if (status && !status.childTaskId) labels[taskId] = status.label
    }
    return labels
  }, [gateStatuses])

  const childTaskLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [taskId, status] of Object.entries(gateStatuses)) {
      if (status?.childTaskId) labels[taskId] = status.childTaskId
    }
    return labels
  }, [gateStatuses])

  const dragStartColumnsRef = useRef<TaskColumns | null>(null)
  const dragFromColRef = useRef<ColumnId | null>(null)
  const dragTaskRef = useRef<Task | null>(null)

  const [pendingBlock, setPendingBlock] = useState<{
    task: Task
    fromCol: ColumnId
  } | null>(null)
  const handleDragStart = useCallback<DragDropEventHandlers['onDragStart']>((event) => {
    const { source } = event.operation
    if (!source || source.type !== 'item') return

    dragStartColumnsRef.current = optimistic?.columns ?? parsed.columns
    dragFromColRef.current = (source.data.columnId ?? source.data.group) as ColumnId
    dragTaskRef.current = source.data.task as Task
  }, [optimistic, parsed.columns])

  const handleDragOver = useCallback<DragDropEventHandlers['onDragOver']>((event) => {
    const { source } = event.operation
    if (!source || source.type !== 'item') return

    const currentColumns = optimistic?.columns ?? dragStartColumnsRef.current ?? parsed.columns
    const nextColumns = hasBoardFilters
      ? mergeVisibleColumns(
          currentColumns,
          filterBoardColumns(currentColumns, search, agentFilter),
          applyMove(filterBoardColumns(currentColumns, search, agentFilter), event),
        )
      : applyMove(currentColumns, event)
    if (areTaskOrdersEqual(currentColumns, nextColumns)) return

    setOptimistic({ columns: nextColumns })
  }, [agentFilter, hasBoardFilters, optimistic, parsed.columns, search])

  const handleDragEnd = useCallback<DragDropEventHandlers['onDragEnd']>(async (event) => {
    const { source, target } = event.operation
    const originalColumns = dragStartColumnsRef.current
    const fromCol = dragFromColRef.current
    const task = dragTaskRef.current

    dragStartColumnsRef.current = null
    dragFromColRef.current = null
    dragTaskRef.current = null

    if (!originalColumns || !fromCol || !task || !source || source.type !== 'item') {
      setOptimistic(null)
      return
    }

    if (event.canceled) {
      setOptimistic(null)
      return
    }

    const finalColumns = target
      ? (optimistic?.columns ?? (
          hasBoardFilters
            ? mergeVisibleColumns(
                originalColumns,
                filterBoardColumns(originalColumns, search, agentFilter),
                applyMove(filterBoardColumns(originalColumns, search, agentFilter), event),
              )
            : applyMove(originalColumns, event)
        ))
      : originalColumns
    const finalCol = findTaskColumn(finalColumns, task.id) ?? fromCol

    if (areTaskOrdersEqual(originalColumns, finalColumns)) {
      setOptimistic(null)
      return
    }

    const sourceTasks = finalColumns[fromCol]
    const targetTasks = finalColumns[finalCol]

    setOptimistic({ columns: finalColumns })

    if (fromCol === finalCol) {
      const ok = await apiFetch('/api/plugins/tasks/reorder', {
        columnId: fromCol,
        orderedIds: sourceTasks.map((t) => t.id),
      })

      if (!ok) toast('Failed to reorder tasks', 'error')
      await refreshTaskboard()
      setOptimistic(null)
      return
    }

    if (finalCol === 'blocked') {
      setPendingBlock({ task, fromCol })
      return
    }

    const ok = await apiFetch('/api/plugins/tasks/' + task.id + '/move', {
      id: task.id, title: task.title, from: fromCol, to: finalCol,
      agent: 'human', channel: 'human',
    })

    if (ok) {
      await apiFetch('/api/plugins/tasks/reorder', {
        columnId: fromCol,
        orderedIds: sourceTasks.map((t) => t.id),
      })
      await apiFetch('/api/plugins/tasks/reorder', {
        columnId: finalCol,
        orderedIds: targetTasks.map((t) => t.id),
      })
    } else {
      toast(`Failed to move "${task.title}"`, 'error')
    }

    await refreshTaskboard()
    setOptimistic(null)
  }, [agentFilter, hasBoardFilters, optimistic, refreshTaskboard, search])

  const [detailTask, setDetailTask] = useState<{ task: Task; columnId: ColumnId } | null>(null)
  const [editing, setEditing] = useState(false)

  const taskIdHandled = useRef(false)
  useEffect(() => {
    if (!taskIdParam || taskIdHandled.current) return
    taskIdHandled.current = true

    for (const [colId, colTasks] of Object.entries(columns) as [ColumnId, Task[]][]) {
      const match = colTasks.find(t => t.id === taskIdParam)
      if (match) {
        setDetailTask({ task: match, columnId: colId })
        setEditing(false)
        setTaskIdParam('')
        return
      }
    }
    toast('Task not found', 'error')
    setTaskIdParam('')
  }, [taskIdParam, columns, setTaskIdParam])
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const ok = await apiFetch('/api/plugins/tasks/' + deleteTarget.id, { id: deleteTarget.id, title: deleteTarget.title }, 'DELETE')
    if (ok) {
      toast(`Deleted "${deleteTarget.title}"`, 'success')
      await refreshTaskboard()
    }
    setDeleteTarget(null)
  }, [deleteTarget, refreshTaskboard])

  const openArchivedLog = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', 'table')
    params.set('status', 'archived')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full min-w-0 min-h-0">
        <div className="hidden md:block px-6 pt-[25px] pb-2 border-b border-border/50">
          <TaskMetrics columns={columns} timestamp={timestamp} />
        </div>

        <div className="px-6 pt-3 md:pt-4 pb-2">
          <PluginHeader
            title="Tasks"
            count={view === 'kanban'
              ? countVisibleTasks(filteredColumns, showScheduled)
              : allTasksFlat.length
            }
            search={{ value: search, onChange: setSearch, placeholder: 'Search tasks...' }}
            actions={
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
                  <button
                    onClick={() => setView('kanban')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      view === 'kanban'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Kanban className="size-3.5" />
                    Board
                  </button>
                  <button
                    onClick={() => setView('table')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      view === 'table'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Table2 className="size-3.5" />
                    Log
                  </button>
                </div>
                <Button size="sm" onClick={() => { setDetailTask(null); setEditing(true) }}>
                  <Plus className="size-4" />
                  New Task
                </Button>
              </div>
            }
          />
        </div>

        <div className="px-6 pb-3">
          <TaskFilters
            agentFilter={agentFilter}
            onAgentChange={setAgentFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            showStatusFilter={view === 'table'}
            showScheduled={showScheduled}
            onShowScheduledChange={(show) => setScheduledView(show ? 'show' : 'hide')}
            statusCounts={aggregations?.status ? Object.fromEntries(aggregations.status.map(a => [a.value, a.count])) : undefined}
          />
        </div>

        {view === 'kanban' ? (
          <DragDropProvider
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex-1 overflow-auto min-h-0">
              <div className="inline-flex gap-4 items-start p-[25px] pt-0 md:pl-[25px] pl-4">
                {COLUMN_ORDER.map((colId) => (
                  <div key={colId} className="w-[75vw] sm:w-72 shrink-0">
                    <KanbanColumn
                      id={colId}
                      tasks={colId === 'archived' ? [] : filteredColumns[colId]}
                      gateLabels={gateLabels}
                      childTaskLabels={childTaskLabels}
                      scoreMap={scoreMap}
                      onDelete={setDeleteTarget}
                      onTaskClick={(task, columnId) => { setDetailTask({ task, columnId }); setEditing(false) }}
                      compact={colId === 'archived'}
                      totalCount={colId === 'archived' ? columns.archived.length : undefined}
                      showScheduled={showScheduled}
                      onHeaderClick={colId === 'archived' ? openArchivedLog : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          </DragDropProvider>
        ) : (
          <div className="flex-1 overflow-auto min-h-0 px-6 pb-[25px]">
            <TaskLogTable currentTasks={allTasksFlat} statusFilter={statusFilter} isSearching={Boolean(search)} scoreMap={scoreMap} />
          </div>
        )}

        <TaskDetailDrawer
          task={detailTask?.task ?? null}
          columnId={detailTask?.columnId ?? null}
          open={editing || !!detailTask}
          editing={editing}
          onClose={() => { setDetailTask(null); setEditing(false) }}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onDelete={(task) => {
            setDetailTask(null)
            setEditing(false)
            setDeleteTarget({ id: task.id, title: task.title })
          }}
          onDuplicate={async (task) => {
            const ok = await apiFetch('/api/plugins/tasks/', {
              title: `${task.title} (copy)`,
              description: task.description || undefined,
              column: detailTask?.columnId || 'todo',
              assignee: task.agent || undefined,
              workflowId: task.workflowId || undefined,
            })
            if (ok) {
              toast(`Duplicated "${task.title}"`, 'success')
              await refreshTaskboard()
            }
          }}
        />

        <DeleteTaskDialog
          title={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />

        <BlockReasonDialog
          taskTitle={pendingBlock?.task.title ?? null}
          onConfirm={async (reason) => {
            if (!pendingBlock) return
            const { task, fromCol } = pendingBlock
            setPendingBlock(null)
            const ok = await apiFetch('/api/plugins/tasks/' + task.id + '/move', {
              id: task.id, title: task.title, from: fromCol, to: 'blocked',
              agent: 'human', channel: 'human', reason,
            })
            if (ok) {
              const currentOpt = optimistic?.columns ?? parsed.columns
              const sourceTasks = currentOpt[fromCol].filter(t => t.id !== task.id)
              const blockedTasks = currentOpt.blocked
              await apiFetch('/api/plugins/tasks/reorder', {
                columnId: fromCol,
                orderedIds: sourceTasks.map(t => t.id),
              })
              await apiFetch('/api/plugins/tasks/reorder', {
                columnId: 'blocked',
                orderedIds: blockedTasks.map(t => t.id),
              })
            } else {
              toast(`Failed to block "${task.title}"`, 'error')
            }
            await refreshTaskboard()
            setOptimistic(null)
          }}
          onCancel={() => {
            setPendingBlock(null)
            setOptimistic(null)
          }}
        />
      </div>
    </>
  )
}
