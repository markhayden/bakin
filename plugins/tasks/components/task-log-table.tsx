'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, Skeleton, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@makinbakin/sdk/ui'
import {
  AgentAvatar,
  SortableHead,
  StatusBadge,
  type SortDir,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { EmptyState } from "@makinbakin/sdk/components"
import { ClipboardList } from 'lucide-react'
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
        const res = await fetch('/api/plugins/memory/audit')
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

  function formatDate(d?: string) {
    return d ? formatDateTime(d) : '—'
  }

  function taskDuration(created?: string, completed?: string) {
    if (!created || !completed) return '—'
    const ms = new Date(completed).getTime() - new Date(created).getTime()
    if (!Number.isFinite(ms) || ms < 0) return '—'
    return formatDuration(ms) ?? '—'
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">ID</TableHead>
                <SortableHead field="title" current={sortField} dir={sortDir} onSort={toggleSort}>Title</SortableHead>
                <SortableHead field="agent" current={sortField} dir={sortDir} onSort={toggleSort}>Agent</SortableHead>
                <SortableHead field="status" current={sortField} dir={sortDir} onSort={toggleSort}>Status</SortableHead>
                <SortableHead field="createdAt" current={sortField} dir={sortDir} onSort={toggleSort}>Created</SortableHead>
                <SortableHead field="completedAt" current={sortField} dir={sortDir} onSort={toggleSort}>Completed</SortableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(task => {
                const created = getCreatedAt(task)
                const completed = getCompletedAt(task)
                const drawerTask = taskForDrawer(task)
                const scoreInfo = scoreMap?.get(task.id)
                const semKey = 'embeddings'
                const bm25Key = scoreInfo?.indexScores
                  ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
                  : undefined
                return (
                  <TableRow
                    key={task.id}
                    data-task-log-row=""
                    className="cursor-pointer"
                    onClick={() => onTaskOpen(drawerTask, task.status)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{task.id.slice(0, 8)}</TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Open ${task.title}`}
                          className="h-auto min-w-0 max-w-full justify-start px-bakin-1 py-bakin-1 text-left"
                          onClick={(event) => {
                            event.stopPropagation()
                            onTaskOpen(drawerTask, task.status)
                          }}
                        >
                          <span className="truncate">{task.title}</span>
                        </Button>
                        {scoreInfo && (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
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
                    </TableCell>
                    <TableCell>
                      {task.agent ? (
                        <AgentCell agentId={task.agent} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONES[task.status]}>{COLUMN_CONFIG[task.status].label}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(created)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(completed)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {taskDuration(created, completed)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function AgentCell({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId
  return (
    <span className="flex items-center gap-1.5">
      <AgentAvatar
        agent={{ id: agentId, name, imageSrc: agent?.headshot }}
        size="xs"
        decorative
      />
      <span className="text-xs">{name}</span>
    </span>
  )
}
