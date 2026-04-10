'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, MessageSquare, CheckCircle, Trash2 } from 'lucide-react'
import type { ContentAgent } from '../types'
import { AGENT_INFO } from '../types'

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
}

export function SessionList({ onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/calendar/sessions')
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

  const handleCreateSession = async (agentId: string) => {
    setCreating(true)
    try {
      const res = await fetch('/api/plugins/calendar/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      if (res.ok) {
        const data = await res.json()
        onSelectSession(data.session.id)
      }
    } catch {
      // Silently fail
    } finally {
      setCreating(false)
      setShowAgentPicker(false)
    }
  }

  const handleDeleteSession = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/plugins/calendar/sessions/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      }
    } catch {
      // Silently fail
    } finally {
      setDeleteTarget(null)
    }
  }

  // Group by agent, active before completed, sorted by updatedAt desc
  const grouped = useMemo(() => {
    const active = sessions
      .filter(s => s.status === 'active')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    const completed = sessions
      .filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return [...active, ...completed]
  }, [sessions])

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
  if (sessions.length === 0 && !showAgentPicker) {
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
                onClick={() => handleCreateSession(agentId)}
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="text-sm font-medium">Planning Sessions</h3>
        <div className="relative">
          <Button
            size="sm"
            onClick={() => setShowAgentPicker(!showAgentPicker)}
            disabled={creating}
          >
            <Plus className="size-3.5 mr-1" />
            New Session
          </Button>

          {showAgentPicker && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
              {CONTENT_AGENTS.map(agentId => {
                const info = AGENT_INFO[agentId]
                return (
                  <button
                    key={agentId}
                    onClick={() => handleCreateSession(agentId)}
                    disabled={creating}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
                    data-testid={`agent-option-${agentId}`}
                  >
                    <AgentAvatar agentId={agentId} size="xs" />
                    <span>{info.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Session list grouped by agent */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
                {agentSessions.map(session => (
                  <button
                    key={session.id}
                    onClick={() => onSelectSession(session.id)}
                    className="group flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-muted/50 transition-colors text-left"
                    data-testid={`session-entry-${session.id}`}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(session)
                        }}
                        className="text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        data-testid={`delete-${session.id}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <span className="text-foreground font-medium">{deleteTarget?.title}</span> and all its proposals. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSession} data-testid="confirm-delete">
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
