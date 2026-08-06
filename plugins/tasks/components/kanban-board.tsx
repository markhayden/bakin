'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/dom'
import { move } from '@dnd-kit/helpers'
import { DragDropProvider, type DragDropEventHandlers } from '@dnd-kit/react'
import {
  toast,
  useContentStore,
  useDebug,
  useJsonFetch,
  usePluginEvent,
  type SearchResult,
} from '@makinbakin/sdk/hooks'
import {
  usePathname,
  useQueryArrayState,
  useQueryState,
  useRouter,
  useSearchParams,
} from '@makinbakin/sdk/navigation'
import {
  Page,
  PageBody,
  PageControls,
  PageHeader,
  SearchDegradedChip,
  SearchInput,
  SearchPartialChip,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState } from '@makinbakin/sdk/ui'
import { Kanban, Plus, Table2 } from 'lucide-react'
import { KanbanColumn } from './kanban-column'
import { DeleteTaskDialog } from './delete-task-dialog'
import { BlockReasonDialog } from './block-reason-dialog'
import { TaskDetailDrawer } from './task-detail-dialog'
import { TaskMetrics } from './task-metrics'
import { TaskFilters } from './task-filters'
import { TaskLogTable } from './task-log-table'
import { filterBoardColumns, useTaskFilters } from '../hooks/use-task-filters'
import { countVisibleTasks } from '../lib/scheduled'
import { useGateStatus } from '../hooks/use-gate-status'
import { useBudgetStatus, budgetHoldReason, type BudgetHold } from '../hooks/use-budget-status'
import { useBrandStatus, brandHoldReason, type BrandHold } from '../hooks/use-brand-status'
import { useLiveActivity } from '../hooks/use-live-activity'
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

function applyFilteredMove(
  columns: TaskColumns,
  search: string,
  agentFilter: string,
  searchResults: SearchResult[],
  brandFilter: string[],
  event: unknown,
): TaskColumns {
  const visibleColumns = filterBoardColumns(columns, search, agentFilter, searchResults, brandFilter)
  return mergeVisibleColumns(columns, visibleColumns, applyMove(visibleColumns, event))
}

export function KanbanBoard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [boardData, setBoardData] = useState<{ columns: TaskColumns; timestamp?: string }>({ columns: emptyBoard })
  const [boardLoaded, setBoardLoaded] = useState(false)
  const [boardRefreshing, setBoardRefreshing] = useState(false)
  const [boardFailed, setBoardFailed] = useState(false)
  const boardLoadedRef = useRef(false)
  const loading = useContentStore((s) => s.loading)

  const fetchBoard = useCallback(async () => {
    setBoardRefreshing(true)
    if (!boardLoadedRef.current) setBoardFailed(false)
    try {
      const res = await fetch('/api/plugins/tasks/')
      if (!res.ok) throw new Error(`Task board request failed (${res.status})`)
      const data = await res.json()
      setBoardData({ columns: data.columns ?? emptyBoard, timestamp: data.timestamp })
      boardLoadedRef.current = true
      setBoardLoaded(true)
      setBoardFailed(false)
    } catch {
      // A background refresh never discards already-usable content. Only the
      // initial load owns the result-region error state.
      if (!boardLoadedRef.current) {
        setBoardFailed(true)
      }
    } finally {
      setBoardRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchBoard() }, [fetchBoard])
  usePluginEvent('taskboard', fetchBoard)

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
  const [brandFilter, setBrandFilter] = useQueryArrayState('brand')
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
  const hasBoardFilters = Boolean(search) || agentFilter !== 'all' || brandFilter.length > 0

  const { filteredColumns, allTasksFlat, aggregations, searchResults, searchStatus, searchMeta } = useTaskFilters(displayColumns, {
    search, agentFilter, statusFilter, brandFilter,
  })

  // Brand facet options + the opt-in unbranded nudge flag ride the brands
  // list response (#419) — no separate settings fetch from the tasks plugin.
  const { data: brandsData } = useJsonFetch<{ brands?: Array<{ id: string; name: string; draft?: boolean }>; warnUnbranded?: boolean }>('/api/plugins/brands/')
  const brandOptions = useMemo(
    () => (brandsData?.brands ?? []).filter(b => !b.draft).map(b => ({ id: b.id, name: b.name })),
    [brandsData],
  )
  const warnUnbranded = Boolean(brandsData?.warnUnbranded)

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

  // Budget-deferred badges (cost-control v2): todo tasks whose dispatch the
  // spend gate is currently holding — derived from the side-effect-free
  // status poll, never from task metadata.
  const budgetStatus = useBudgetStatus()
  const liveActivity = useLiveActivity()
  const budgetHolds = useMemo(() => {
    const holds: Record<string, BudgetHold> = {}
    for (const task of columns.todo) {
      const hold = budgetHoldReason(budgetStatus, task)
      if (hold) holds[task.id] = hold
    }
    return holds
  }, [columns.todo, budgetStatus])

  // Brand-blocked badges (#419): todo tasks deferring on a missing/draft
  // brand — same derived-state pattern as budget holds.
  const brandStatus = useBrandStatus()
  const brandHolds = useMemo(() => {
    const holds: Record<string, BrandHold> = {}
    for (const task of columns.todo) {
      const hold = brandHoldReason(brandStatus, task)
      if (hold) holds[task.id] = hold
    }
    return holds
  }, [columns.todo, brandStatus])

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
      ? applyFilteredMove(currentColumns, search, agentFilter, searchResults, brandFilter, event)
      : applyMove(currentColumns, event)
    if (areTaskOrdersEqual(currentColumns, nextColumns)) return

    setOptimistic({ columns: nextColumns })
  }, [agentFilter, brandFilter, hasBoardFilters, optimistic, parsed.columns, search, searchResults])

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
            ? applyFilteredMove(originalColumns, search, agentFilter, searchResults, brandFilter, event)
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
  }, [agentFilter, brandFilter, hasBoardFilters, optimistic, refreshTaskboard, search, searchResults])

  const [detailTask, setDetailTask] = useState<{ task: Task; columnId: ColumnId } | null>(null)
  const [editing, setEditing] = useState(false)

  const taskIdHandled = useRef(false)
  useEffect(() => {
    // Wait for the first board fetch — consuming the param against the empty
    // initial board silently ate deep links on fresh page loads.
    if (!taskIdParam || taskIdHandled.current || !boardLoaded) return
    taskIdHandled.current = true

    // Search the UNFILTERED board so active agent/search filters can't hide
    // the deep-linked task.
    for (const [colId, colTasks] of Object.entries(boardData.columns) as [ColumnId, Task[]][]) {
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
  }, [taskIdParam, boardLoaded, boardData.columns, setTaskIdParam])
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

  const openNewTask = useCallback(() => {
    setDetailTask(null)
    setEditing(true)
  }, [])

  const clearFilters = useCallback(() => {
    setSearch('')
    setAgentFilter('all')
    setStatusFilter([])
    setBrandFilter([])
    setScheduledView('show')
  }, [setAgentFilter, setBrandFilter, setScheduledView, setSearch, setStatusFilter])

  const resultCount = view === 'kanban'
    ? countVisibleTasks(filteredColumns, showScheduled)
    : allTasksFlat.length
  const hasActiveResultFilters = Boolean(search.trim())
    || agentFilter !== 'all'
    || brandFilter.length > 0
    || (view === 'table' && statusFilter.length > 0)
    || (view === 'kanban' && !showScheduled)
  const initialLoading = !boardFailed && (Boolean(loading) || !boardLoaded)
  const searchSettled = !search.trim() || searchStatus !== 'loading'

  const searchFeedback = search.trim() && (searchStatus === 'unavailable' || searchMeta?.partial) ? (
    <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
      {searchStatus === 'unavailable' && <SearchDegradedChip testId="tasks-search-degraded" />}
      {searchMeta?.partial && <SearchPartialChip meta={searchMeta} />}
    </div>
  ) : undefined

  let resultState: React.ReactNode
  if (initialLoading) {
    resultState = (
      <SystemState
        kind="loading"
        title="Loading tasks"
        description="The latest task board will appear here when it is ready."
      />
    )
  } else if (boardFailed && !boardLoaded) {
    resultState = (
      <SystemState
        kind="error"
        recovery="available"
        title="Tasks could not be loaded"
        description="The task service did not return a usable board. Try the request again."
        action={<Button variant="outline" onClick={() => void fetchBoard()}>Try again</Button>}
      />
    )
  } else if (boardLoaded && searchSettled && resultCount === 0) {
    resultState = hasActiveResultFilters ? (
      <SystemState
        kind="no-results"
        title="No tasks match this view"
        description="Clear the current search and filters to return to the complete task board."
        action={<Button variant="outline" onClick={clearFilters}>Clear search and filters</Button>}
      />
    ) : (
      <SystemState
        kind="initial-empty"
        title="No tasks yet"
        description="Create the first task to start coordinating work."
        action={<Button onClick={openNewTask}><Plus />Create first task</Button>}
      />
    )
  }

  return (
    <>
      <Page scroll="contained">
        <PageHeader
          title="Tasks"
          description="Create, assign, and track work across your agents from the backlog through completion."
          meta={boardLoaded ? <Badge size="xs" variant="outline">{resultCount} shown</Badge> : undefined}
          controlsLabel="Task search, view, and actions"
          controls={(
            <div className="grid w-full min-w-0 gap-bakin-2 @3xl/page-header:flex @3xl/page-header:items-start">
              <SearchInput
                align="end"
                label="Task search"
                value={search}
                onValueChange={setSearch}
                placeholder="Search tasks…"
                busy={searchStatus === 'loading'}
                mobileFullWidth
              />
              <div className="flex min-w-0 flex-wrap items-center gap-bakin-2 @3xl/page-header:shrink-0 @3xl/page-header:flex-nowrap">
                <SegmentedControl
                  options={[
                    { value: 'kanban', label: 'Board', icon: Kanban },
                    { value: 'table', label: 'Log', icon: Table2 },
                  ]}
                  value={view as 'kanban' | 'table'}
                  onValueChange={setView}
                  ariaLabel="Task view"
                  size="md"
                  className="shrink-0 [&_[role=tab]]:px-bakin-3"
                />
                <Button className="min-w-28 flex-1 @3xl/page-header:flex-none" onClick={openNewTask}>
                  <Plus />
                  New Task
                </Button>
              </div>
            </div>
          )}
        />

        <div className="hidden md:block">
          <TaskMetrics columns={columns} timestamp={timestamp} />
        </div>

        <PageControls label="Task filters" divider>
          <TaskFilters
            agentFilter={agentFilter}
            onAgentChange={setAgentFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            showStatusFilter={view === 'table'}
            showScheduled={showScheduled}
            onShowScheduledChange={(show) => setScheduledView(show ? 'show' : 'hide')}
            statusCounts={aggregations?.status ? Object.fromEntries(aggregations.status.map(a => [a.value, a.count])) : undefined}
            brandFilter={brandFilter}
            onBrandChange={setBrandFilter}
            brandOptions={brandOptions}
          />
        </PageControls>

        <PageBody
          label="Task results"
          busy={boardLoaded && boardRefreshing}
          feedback={searchFeedback}
          state={resultState}
          className="min-h-0 flex-1"
        >
          {view === 'kanban' ? (
            <DragDropProvider
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div
                role="region"
                aria-label="Task board"
                tabIndex={0}
                data-task-board-scroll
                className="flex-1 min-h-0 max-w-full min-w-0 overflow-auto overscroll-x-contain focus-visible:rounded-bakin-control focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
              >
                <div data-task-board-track className="inline-flex items-start gap-4 pb-bakin-2">
                  {COLUMN_ORDER.map((colId) => (
                    <div key={colId} data-task-board-column className="w-72 shrink-0">
                      <KanbanColumn
                        id={colId}
                        tasks={colId === 'archived' ? [] : filteredColumns[colId]}
                        gateLabels={gateLabels}
                        childTaskLabels={childTaskLabels}
                        budgetHolds={budgetHolds}
                        brandHolds={brandHolds}
                        liveActivity={liveActivity}
                        warnUnbranded={warnUnbranded}
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
            <div className="flex-1 overflow-auto min-h-0 pb-bakin-2">
              <TaskLogTable
                currentTasks={allTasksFlat}
                statusFilter={statusFilter}
                isSearching={Boolean(search)}
                scoreMap={scoreMap}
                onTaskOpen={(task, columnId) => {
                  setDetailTask({ task, columnId })
                  setEditing(false)
                }}
              />
            </div>
          )}
        </PageBody>
      </Page>

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
    </>
  )
}
