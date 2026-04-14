'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { MessageSquare, CheckCircle, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { SearchResult } from '@/hooks/use-search'
import { useDebug } from '@/hooks/use-debug'
import { DeleteSessionDialog } from './delete-session-dialog'
import type { ContentAgent } from '../types'
import { AGENT_INFO } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

const CONTENT_AGENTS = Object.keys(AGENT_INFO) as ContentAgent[]

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

interface Props {
  onSelectSession: (sessionId: string) => void
  search?: string
  searchResults?: SearchResult[]
  onCountChange?: (count: number) => void
  onCreateSession?: (agentId: string) => void
  creating?: boolean
}

export function SessionList({ onSelectSession, search, searchResults, onCountChange, onCreateSession, creating }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)
  const [debug] = useDebug()

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

  // Report count to parent
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

  // Build a score map keyed by session id (stripping the `brainstorm-` Antfly
  // prefix). Used for both the relevance reorder AND the debug-mode RRF/BM25/SEM
  // overlay, so build it once here.
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScoreInfo>()
    if (!searchResults) return map
    for (const r of searchResults) {
      const id = r.id.startsWith('brainstorm-') ? r.id.slice('brainstorm-'.length) : r.id
      map.set(id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [searchResults])

  // Filter by search. When the Antfly-backed hook returned hits, trust them
  // and reorder by score. When it returned nothing (or search is empty),
  // fall back to a local substring match on title/agentId so the UI stays
  // usable while the index is cold or disabled.
  const filtered = useMemo(() => {
    if (!search?.trim()) return sessions
    if (searchResults && searchResults.length > 0) {
      return sessions
        .filter(s => scoreMap.has(s.id))
        .sort((a, b) => (scoreMap.get(b.id)?.score ?? 0) - (scoreMap.get(a.id)?.score ?? 0))
    }
    const q = search.toLowerCase()
    return sessions.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.agentId.toLowerCase().includes(q)
    )
  }, [sessions, search, searchResults, scoreMap])

  // Group by agent, active before completed, sorted by updatedAt desc
  const grouped = useMemo(() => {
    const active = filtered
      .filter(s => s.status === 'active')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    const completed = filtered
      .filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return [...active, ...completed]
  }, [filtered])

  const sessionsByAgent = useMemo(() => {
    const groups: Record<string, SessionSummary[]> = {}
    for (const s of grouped) {
      if (!groups[s.agentId]) groups[s.agentId] = []
      groups[s.agentId].push(s)
    }
    return groups
  }, [grouped])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <span className="text-sm">Loading sessions...</span>
      </div>
    )
  }

  // Empty state
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
          {CONTENT_AGENTS.map(agentId => {
            const info = AGENT_INFO[agentId]
            return (
              <button
                key={agentId}
                onClick={() => onCreateSession?.(agentId)}
                disabled={creating}
                className="flex items-center gap-3 p-4 rounded-lg border border-border bg-surface hover:bg-muted/50 transition-colors text-left"
                data-testid={`agent-card-${agentId}`}
              >
                <AgentAvatar agentId={agentId} size="md" />
                <div>
                  <div className="text-sm font-medium text-foreground">{info.name}</div>
                  <div className="text-xs text-muted-foreground">Start planning</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // No results for search
  if (filtered.length === 0 && search) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <span className="text-sm">No sessions matching &ldquo;{search}&rdquo;</span>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {Object.entries(sessionsByAgent).map(([agentId, agentSessions]) => {
          const info = AGENT_INFO[agentId as ContentAgent]
          return (
            <div key={agentId} data-testid={`agent-group-${agentId}`}>
              <div className="flex items-center gap-2 mb-2">
                <AgentAvatar agentId={agentId} size="xs" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {info?.name || agentId}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {agentSessions.length}
                </Badge>
              </div>

              <div className="space-y-1.5">
                {agentSessions.map(session => {
                  const scoreInfo = scoreMap.get(session.id)
                  const showScores = debug && scoreInfo && search?.trim()
                  const semKey = 'embeddings'
                  const bm25Key = scoreInfo?.indexScores
                    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
                    : undefined
                  return (
                  <div
                    key={session.id}
                    className="group flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-muted/50 transition-colors cursor-pointer"
                    data-testid={`session-entry-${session.id}`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {session.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-0.5">
                          <MessageSquare className="size-3" />
                          {session.proposalCount} proposals
                        </span>
                        {showScores && scoreInfo && (
                          <span className="flex items-center gap-2 font-mono text-[10px]">
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
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {session.proposalCount > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {session.approvedCount}/{session.proposalCount}
                        </Badge>
                      )}
                      {session.status === 'completed' ? (
                        <CheckCircle className="size-3.5 text-emerald-400" />
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                          Active
                        </Badge>
                      )}

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
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <DeleteSessionDialog
        open={!!deleteTarget}
        title={deleteTarget?.title ?? ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
