'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { STATUS_BADGE_STYLES, AGENT_AVATAR_COLORS, COLUMN_CONFIG } from '../constants'
import { AGENTS } from '@/lib/constants'
import { ArrowUpDown } from 'lucide-react'
import type { FlatTask } from '../hooks/use-task-filters'
import type { ColumnId } from '../types'

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

function getCreatedAt(t: TaskRow): string | undefined {
  if ('createdAt' in t) return (t as HistoricalTask).createdAt
  return (t as FlatTask).date
}

function getCompletedAt(t: TaskRow): string | undefined {
  if ('completedAt' in t) return (t as HistoricalTask).completedAt
  const flat = t as FlatTask
  return (flat.status === 'done' || flat.status === 'confirmed') ? flat.date : undefined
}

type SortField = 'title' | 'agent' | 'status' | 'createdAt' | 'completedAt'
type SortDir = 'asc' | 'desc'

const STATUS_TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  ...(['todo', 'blocked', 'inProgress', 'review', 'done', 'confirmed'] as ColumnId[]).map(id => ({
    id,
    label: COLUMN_CONFIG[id].label,
  })),
]

interface TaskLogTableProps {
  /** Pre-filtered tasks from the parent (search + agent already applied) */
  currentTasks: FlatTask[]
}

export function TaskLogTable({ currentTasks }: TaskLogTableProps) {
  const [auditTasks, setAuditTasks] = useState<HistoricalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('completedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('all')

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
            if (entry.data.to === 'done' || entry.data.to === 'confirmed') {
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

  // Status filter (table-specific — search + agent already applied by parent)
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return allTasks
    return allTasks.filter(t => t.status === statusFilter)
  }, [allTasks, statusFilter])

  // Sort
  const sorted = useMemo(() => {
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
  }, [filtered, sortField, sortDir])

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }, [sortField])

  function formatDate(d?: string) {
    if (!d) return '—'
    const date = new Date(d)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  function formatDuration(created?: string, completed?: string) {
    if (!created || !completed) return '—'
    const ms = new Date(completed).getTime() - new Date(created).getTime()
    if (ms < 0) return '—'
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ${mins % 60}m`
    const days = Math.floor(hrs / 24)
    return `${days}d ${hrs % 24}h`
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Status tabs — table-specific filter */}
      <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 w-fit">
        {STATUS_TABS.map(tab => {
          const isActive = statusFilter === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Loading task history...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No tasks found
          </div>
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
                const badgeStyle = STATUS_BADGE_STYLES[task.status as ColumnId]
                return (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{task.id.slice(0, 8)}</TableCell>
                    <TableCell className="max-w-[300px] truncate">{task.title}</TableCell>
                    <TableCell>
                      {task.agent ? (
                        <AgentCell agentId={task.agent} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {badgeStyle && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${badgeStyle.bg}`}>
                          {badgeStyle.label}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(created)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(completed)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {formatDuration(created, completed)}
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
  const agent = AGENTS.find(a => a.id === agentId)
  const [imgError, setImgError] = useState(false)
  return (
    <span className="flex items-center gap-1.5">
      {!imgError ? (
        <img
          src={`/headshots/${agentId}.png`}
          alt={agent?.name ?? agentId}
          onError={() => setImgError(true)}
          className="size-5 rounded-full object-cover object-top ring-1 ring-zinc-700 shrink-0"
        />
      ) : (
        <span className={`size-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${AGENT_AVATAR_COLORS[agentId] || 'bg-zinc-400'}`}>
          {agent?.emoji ?? '?'}
        </span>
      )}
      <span className="text-xs">{agent?.name ?? agentId}</span>
    </span>
  )
}

function SortableHead({ field, current, dir, onSort, children }: {
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
  children: React.ReactNode
}) {
  const isActive = current === field
  return (
    <TableHead>
      <button
        onClick={() => onSort(field)}
        className={`flex items-center gap-1 hover:text-foreground transition-colors ${
          isActive ? 'text-foreground' : ''
        }`}
      >
        {children}
        <ArrowUpDown className={`size-3 ${isActive ? 'opacity-100' : 'opacity-40'}`} />
        {isActive && <span className="text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  )
}
