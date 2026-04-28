'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { AgentAvatar } from "@bakin/sdk/components"
import { SortableHead, type SortDir } from "@bakin/sdk/components"
import { Skeleton } from "@bakin/sdk/ui"
import { EmptyState } from "@bakin/sdk/components"
import { MessageSquare, CheckCircle, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@bakin/sdk/ui"
import type { SearchResult } from "@bakin/sdk/hooks"
import { useDebug } from "@bakin/sdk/hooks"
import { DeleteSessionDialog } from './delete-session-dialog'
import { useAgentList } from "@bakin/sdk/hooks"

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

interface SessionSummary {
  id: string
  agentId: string
  title: string
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  proposalCount: number
  approvedCount: number
}

type SortField = 'title' | 'agent' | 'threads' | 'status' | 'updatedAt'

interface Props {
  onSelectSession: (sessionId: string) => void
  search?: string
  searchResults?: SearchResult[]
  searchLoading?: boolean
  agentFilter?: string
  onCountChange?: (count: number) => void
  onCreateSession?: (agentId: string) => void
  creating?: boolean
}

export function SessionList({ onSelectSession, search, searchResults, searchLoading, agentFilter, onCountChange, onCreateSession, creating }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)
  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [debug] = useDebug()
  const agentList = useAgentList()

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/messaging/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    onCountChange?.(sessions.length)
  }, [sessions.length, onCountChange])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await fetch(`/api/plugins/messaging/sessions/${deleteTarget.id}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== deleteTarget.id))
    } catch {
      // Silently fail
    }
    setDeleteTarget(null)
  }

  // Score map keyed by session id (strip the `brainstorm-` search key prefix).
  // Used for both the relevance reorder AND the debug-mode RRF/BM25/SEM overlay.
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScoreInfo>()
    if (!searchResults) return map
    for (const r of searchResults) {
      const id = r.id.startsWith('brainstorm-') ? r.id.slice('brainstorm-'.length) : r.id
      map.set(id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [searchResults])

  const filtered = useMemo(() => {
    const agentFiltered = agentFilter && agentFilter !== 'all'
      ? sessions.filter(s => s.agentId === agentFilter)
      : sessions

    if (!search?.trim()) return agentFiltered

    if (scoreMap.size > 0) {
      return agentFiltered
        .filter(s => scoreMap.has(s.id))
        .sort((a, b) => (scoreMap.get(b.id)?.score ?? 0) - (scoreMap.get(a.id)?.score ?? 0))
    }
    // While the search hook is in-flight we don't yet know the search
    // hits — keep the full (agent-filtered) list visible instead of
    // flashing "no matches" during the 300ms debounce window.
    if (searchLoading) return agentFiltered

    const q = search.toLowerCase()
    return agentFiltered.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.agentId.toLowerCase().includes(q)
    )
    // `scoreMap` is derived from `searchResults`; listing both in deps would
    // double-trigger. Keep `scoreMap` since it's what we actually read.
  }, [sessions, search, searchLoading, scoreMap, agentFilter])

  // When searching, relevance order wins — skip manual sort.
  const isSearching = !!search?.trim()
  const sorted = useMemo(() => {
    if (isSearching) return filtered
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortField === 'title') cmp = a.title.localeCompare(b.title)
      else if (sortField === 'agent') cmp = a.agentId.localeCompare(b.agentId)
      else if (sortField === 'threads') cmp = a.proposalCount - b.proposalCount
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status)
      else if (sortField === 'updatedAt') {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      }
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

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-4 gap-6" data-testid="empty-state">
        <div className="space-y-2 max-w-md">
          <h3 className="text-base font-medium text-foreground">Plan your content calendar</h3>
          <p className="text-sm text-muted-foreground">
            Start a planning session with one of your agents. They&apos;ll help brainstorm content ideas,
            propose items for your calendar, and you can approve or revise before confirming.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
          {agentList.map(agent => (
            <button
              key={agent.id}
              onClick={() => onCreateSession?.(agent.id)}
              disabled={creating}
              className="flex items-center gap-3 p-4 rounded-lg border border-border bg-surface hover:bg-muted/50 transition-colors text-left disabled:cursor-not-allowed"
              data-testid={`agent-card-${agent.id}`}
            >
              <AgentAvatar agentId={agent.id} size="md" />
              <div>
                <div className="text-sm font-medium text-foreground">{agent.name}</div>
                <div className="text-xs text-muted-foreground">Start planning</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (filtered.length === 0 && search && !searchLoading) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No matching sessions"
        description={`No sessions matching "${search}"`}
      />
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead field="title" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>Title</SortableHead>
            <SortableHead field="agent" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>Agent</SortableHead>
            <SortableHead field="threads" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>Threads</SortableHead>
            <SortableHead field="status" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>Status</SortableHead>
            <SortableHead field="updatedAt" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>Updated</SortableHead>
            <TableHead className="w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(session => {
            const scoreInfo = scoreMap.get(session.id)
            const showScores = debug && scoreInfo && isSearching
            const semKey = 'embeddings'
            const bm25Key = scoreInfo?.indexScores
              ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
              : undefined
            return (
              <TableRow
                key={session.id}
                className="group cursor-pointer"
                data-testid={`session-entry-${session.id}`}
                onClick={() => onSelectSession(session.id)}
              >
                <TableCell className="max-w-[400px]">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{session.title}</span>
                    {showScores && scoreInfo && (
                      <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                        <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
                        <span className="text-cyan-400">
                          BM25 {bm25Key && scoreInfo.indexScores?.[bm25Key] !== undefined
                            ? scoreInfo.indexScores[bm25Key].toFixed(3)
                            : '—'}
                        </span>
                        <span className="text-purple-400">
                          SEM {scoreInfo.indexScores?.[semKey] !== undefined
                            ? scoreInfo.indexScores[semKey].toFixed(3)
                            : '—'}
                        </span>
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <AgentAvatar agentId={session.agentId} size="xs" />
                    <span className="text-xs text-muted-foreground uppercase">{session.agentId}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="size-3" />
                    {session.proposalCount > 0
                      ? `${session.approvedCount}/${session.proposalCount}`
                      : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  {session.status === 'completed' ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="size-3.5" />
                      Done
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                      Active
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(session.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.06)] transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-36">
                      <DropdownMenuItem
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteTarget(session) }}
                        className="text-red-400 focus:text-red-400"
                      >
                        <Trash2 className="size-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <DeleteSessionDialog
        open={!!deleteTarget}
        title={deleteTarget?.title ?? ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
