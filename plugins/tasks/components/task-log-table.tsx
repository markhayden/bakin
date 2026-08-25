'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, SystemState } from '@makinbakin/sdk/ui'
import {
  AgentAvatar,
  DataTable,
  StatusBadge,
  type DataTableColumn,
  type SortDir,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { COLUMN_CONFIG } from '../constants'
import { formatDateTime, formatDuration } from "@makinbakin/sdk/utils"
import { useAgent } from "@makinbakin/sdk/hooks"
import type { FlatTask } from '../hooks/use-task-filters'
import type { TaskScoreInfo } from './task-card'
import type { ColumnId, Task } from '../types'

interface AuditEntry {
  type: string
  timestamp: string
  agent?: string
  data?: {
    id?: string
    title?: string
    to?: string
    from?: string
  }
}

interface HistoricalTask {
  id: string
  title: string
  agent?: string
  status: ColumnId
  createdAt?: string
  completedAt?: string
}

type TaskRow = FlatTask | HistoricalTask

const STATUS_TONES: Record<ColumnId, StatusTone> = {
  backlog: 'neutral',
  todo: 'accent',
  inProgress: 'accent',
  review: 'attention',
  done: 'success',
  archived: 'neutral',
  blocked: 'danger',
}

function taskForDrawer(task: TaskRow): Task {
  if ('checked' in task) return task
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    checked: task.status === 'done' || task.status === 'archived',
    date: task.createdAt,
  }
}

function getCreatedAt(t: TaskRow): string | undefined {
  if ('createdAt' in t) return (t as HistoricalTask).createdAt
  return (t as FlatTask).date
}

function getCompletedAt(t: TaskRow): string | undefined {
  if ('completedAt' in t) return (t as HistoricalTask).completedAt
  const flat = t as FlatTask
  return (flat.status === 'done' || flat.status === 'archived') ? flat.date : undefined
}

type SortField = 'title' | 'agent' | 'status' | 'createdAt' | 'completedAt'

function formatDate(d?: string) {
  return d ? formatDateTime(d) : '—'
}

function taskDuration(created?: string, completed?: string) {
  if (!created || !completed) return '—'
  const ms = new Date(completed).getTime() - new Date(created).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return formatDuration(ms) ?? '—'
}

interface TaskLogTableProps {
  /** Pre-filtered tasks from the parent (search + agent already applied) */
  currentTasks: FlatTask[]
  /** Status filter from parent (empty = all) */
  statusFilter: string[]
  /** When true, preserve search relevance order instead of manual sort */
  isSearching?: boolean
  /** Per-task search score info, keyed by task id. Only set when debug + active search. */
  scoreMap?: Map<string, TaskScoreInfo>
  /** Opens the canonical task detail drawer for current and historical rows. */
  onTaskOpen: (task: Task, columnId: ColumnId) => void
}

export function TaskLogTable({ currentTasks, statusFilter, isSearching, scoreMap, onTaskOpen }: TaskLogTableProps) {
  const [auditTasks, setAuditTasks] = useState<HistoricalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('completedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    async function fetchAudit() {
      try {
        // Dev rebuilds and engine hiccups can strand a response forever; a hung
        // request must degrade to the current-tasks-only view, not an eternal
        // loading state.
        const res = await fetch('/api/plugins/memory/audit', { signal: AbortSignal.timeout(15_000) })
        if (!res.ok) return
        const { entries } = await res.json() as { entries: AuditEntry[] }

        const taskMap = new Map<string, HistoricalTask>()
        const sorted = [...entries].reverse()
        for (const entry of sorted) {
          const id = entry.data?.id
          if (!id || !entry.type.startsWith('task.')) continue

          const existing = taskMap.get(id) ?? {
            id,
            title: entry.data?.title ?? id,
            agent: entry.agent,
            status: 'todo' as ColumnId,
          }

          if (entry.type === 'task.created') {
            existing.createdAt = entry.timestamp
            if (entry.data?.title) existing.title = entry.data.title
          }
          if (entry.type === 'task.moved' && entry.data?.to) {
            existing.status = entry.data.to as ColumnId
            if (entry.data.to === 'done' || entry.data.to === 'archived') {
              existing.completedAt = entry.timestamp
            }
          }
          if (entry.agent) existing.agent = entry.agent
          taskMap.set(id, existing)
        }

        setAuditTasks(Array.from(taskMap.values()))
      } catch {
        // Gracefully degrade
      } finally {
        setLoading(false)
      }
    }
    fetchAudit()
  }, [])

  // Merge current board tasks with audit history (current takes priority)
  const allTasks = useMemo(() => {
    const merged = new Map<string, FlatTask | HistoricalTask>()
    for (const t of auditTasks) merged.set(t.id, t)
    for (const t of currentTasks) merged.set(t.id, t)
    return Array.from(merged.values())
  }, [currentTasks, auditTasks])

  // Status filter from parent facet
  const filtered = useMemo(() => {
    if (statusFilter.length === 0) return allTasks
    return allTasks.filter(t => statusFilter.includes(t.status))
  }, [allTasks, statusFilter])

  // Sort — skip when searching to preserve relevance order
  const sorted = useMemo(() => {
    if (isSearching) return filtered
    return [...filtered].sort((a, b) => {
      let aVal = '', bVal = ''
      if (sortField === 'title') { aVal = a.title; bVal = b.title }
      else if (sortField === 'agent') { aVal = a.agent ?? ''; bVal = b.agent ?? '' }
      else if (sortField === 'status') { aVal = a.status; bVal = b.status }
      else if (sortField === 'createdAt') { aVal = getCreatedAt(a) ?? ''; bVal = getCreatedAt(b) ?? '' }
      else if (sortField === 'completedAt') { aVal = getCompletedAt(a) ?? ''; bVal = getCompletedAt(b) ?? '' }
      const cmp = aVal.localeCompare(bVal)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir, isSearching])

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }, [sortField])

  const columns = useMemo((): ReadonlyArray<DataTableColumn<TaskRow, SortField>> => [
    {
      key: 'id',
      header: 'ID',
      narrow: 'meta',
      cellClassName: 'font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted',
      cell: (task) => task.id.slice(0, 8),
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      narrow: 'primary',
      cellClassName: 'max-w-sm',
      cell: (task) => {
        const drawerTask = taskForDrawer(task)
        const scoreInfo = scoreMap?.get(task.id)
        const semKey = 'embeddings'
        const bm25Key = scoreInfo?.indexScores
          ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
          : undefined
        return (
          <div className="flex min-w-0 items-center gap-bakin-2">
            <Button
              type="button"
              variant="link"
              size="inline"
              aria-label={`Open ${task.title}`}
              className="min-w-0 max-w-full font-bakin-typography-weight-semibold text-bakin-text-primary"
              onClick={(event) => {
                event.stopPropagation()
                onTaskOpen(drawerTask, task.status)
              }}
            >
              <span className="truncate">{task.title}</span>
            </Button>
            {scoreInfo && (
              <span className="flex shrink-0 items-center gap-bakin-2 font-bakin-typography-family-mono text-bakin-typography-size-meta">
                <span className="text-bakin-data-series-1">RRF {scoreInfo.score.toFixed(3)}</span>
                <span className="text-bakin-data-series-2">
                  BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
                </span>
                <span className="text-bakin-data-series-3">
                  SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
                </span>
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'agent',
      header: 'Agent',
      sortable: true,
      narrow: 'leading',
      cell: (task) => task.agent
        ? <AgentCell agentId={task.agent} />
        : <span className="text-bakin-typography-size-meta text-bakin-text-muted">—</span>,
      narrowCell: (task) => task.agent ? <AgentCell agentId={task.agent} avatarOnly /> : null,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      narrow: 'trailing',
      cell: (task) => (
        <StatusBadge tone={STATUS_TONES[task.status]} size="xs">{COLUMN_CONFIG[task.status].label}</StatusBadge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      narrow: 'meta',
      cellClassName: 'text-bakin-typography-size-meta text-bakin-text-muted',
      cell: (task) => formatDate(getCreatedAt(task)),
      narrowCell: (task) => getCreatedAt(task) ? formatDate(getCreatedAt(task)) : null,
    },
    {
      key: 'completedAt',
      header: 'Completed',
      sortable: true,
      narrow: 'meta',
      cellClassName: 'text-bakin-typography-size-meta text-bakin-text-muted',
      cell: (task) => formatDate(getCompletedAt(task)),
      narrowCell: (task) => getCompletedAt(task) ? formatDate(getCompletedAt(task)) : null,
    },
    {
      key: 'duration',
      header: 'Duration',
      narrow: 'meta',
      cellClassName: 'font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted',
      cell: (task) => taskDuration(getCreatedAt(task), getCompletedAt(task)),
      narrowCell: (task) => {
        const duration = taskDuration(getCreatedAt(task), getCompletedAt(task))
        return duration === '—' ? null : duration
      },
    },
  ], [scoreMap, onTaskOpen])

  return (
    <div className="min-w-0" data-task-log="">
      <div className="min-w-0">
        {loading ? (
          <SystemState
            kind="loading"
            scope="section"
            title="Loading task log"
            description="Current and historical tasks will appear here when the activity log is ready."
          />
        ) : sorted.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="section"
            title="No tasks found"
            description="This task view has no current or historical rows to display."
          />
        ) : (
          <DataTable
            label="Task log"
            // Kept collapsing: these rows carry narrow-render configuration and
            // read better stacked than as a horizontally scrolling table.
            collapseBelow="2xl"
            columns={columns}
            rows={sorted}
            rowKey={(task) => task.id}
            sort={{ field: sortField, dir: sortDir }}
            onSortChange={toggleSort}
            onRowActivate={(task) => onTaskOpen(taskForDrawer(task), task.status)}
            rowActivateLabel={(task) => `Open ${task.title || task.id}`}
            rowProps={() => ({ 'data-task-log-row': '' })}
          />
        )}
      </div>
    </div>
  )
}

function AgentCell({ agentId, avatarOnly = false }: { agentId: string; avatarOnly?: boolean }) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId
  if (avatarOnly) {
    return (
      <AgentAvatar
        agent={{ id: agentId, name, imageSrc: agent?.headshot }}
        size="sm"
      />
    )
  }
  return (
    <span className="flex items-center gap-bakin-2">
      <AgentAvatar
        agent={{ id: agentId, name, imageSrc: agent?.headshot }}
        size="xs"
        decorative
      />
      <span className="text-bakin-typography-size-meta text-bakin-text-primary">{name}</span>
    </span>
  )
}
