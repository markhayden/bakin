'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { ArrowLeft, PanelRight, PanelRightClose, Pencil, Check, X, Calendar } from 'lucide-react'
import { SessionChat } from './session-chat'
import { ReviewPanel } from './review-panel'
import { MiniCalendar } from './mini-calendar'
import type { ContentAgent, PlanningSession, ProposedItem } from '../types'
import { AGENT_INFO } from '../types'

interface Props {
  sessionId: string
  onBack?: () => void
  onSessionUpdated?: () => void
}

export function PlanningLayout({ sessionId, onBack, onSessionUpdated }: Props) {
  const [session, setSession] = useState<PlanningSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReview, setShowReview] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showMiniCal, setShowMiniCal] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/calendar/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSession(data.session)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  const handleTitleSave = async () => {
    if (!titleDraft.trim() || !session) return
    try {
      const res = await fetch(`/api/plugins/calendar/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setSession(data.session)
      }
    } catch {
      // Silently fail
    }
    setEditingTitle(false)
  }

  const handleProposalsReceived = useCallback((newProposals: ProposedItem[]) => {
    setSession((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        proposals: [...prev.proposals, ...newProposals],
      }
    })
  }, [])

  const handleProposalUpdate = useCallback((updated: ProposedItem) => {
    setSession((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        proposals: prev.proposals.map((p) =>
          p.id === updated.id ? updated : p
        ),
      }
    })
  }, [])

  const handleConfirm = useCallback(() => {
    setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
    onSessionUpdated?.()
  }, [onSessionUpdated])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading session...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p>Session not found</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back to sessions
        </Button>
      </div>
    )
  }

  const agentId = session.agentId as ContentAgent
  const agentInfo = AGENT_INFO[agentId]
  const isCompleted = session.status === 'completed'
  const proposalDates = useMemo(
    () => [...new Set(session.proposals.map(p => p.scheduledAt.slice(0, 10)))],
    [session.proposals]
  )

  return (
    <div className="flex flex-col h-full" data-testid="planning-layout">
      {/* Session header */}
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <AgentAvatar agentId={agentId} size="sm" />

        {editingTitle ? (
          <div className="flex items-center gap-1 flex-1">
            <Input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="h-7 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              autoFocus
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleTitleSave}>
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingTitle(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 className="text-sm font-medium truncate">{session.title}</h2>
            {!isCompleted && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTitleDraft(session.title)
                  setEditingTitle(true)
                }}
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}

        <Badge variant="outline" className="text-[10px] shrink-0">
          {agentInfo?.name || agentId}
        </Badge>

        {isCompleted && (
          <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px] shrink-0">
            Completed
          </Badge>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setShowMiniCal(!showMiniCal)}
          title={showMiniCal ? 'Hide calendar' : 'Show calendar'}
        >
          <Calendar className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setShowReview(!showReview)}
          title={showReview ? 'Hide review panel' : 'Show review panel'}
        >
          {showReview ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRight className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel */}
        <div className={`flex-1 min-w-0 ${showReview ? 'md:w-[60%]' : 'w-full'}`}>
          <SessionChat
            sessionId={sessionId}
            agentId={agentId}
            initialMessages={session.messages}
            initialProposals={session.proposals}
            isCompleted={isCompleted}
            onProposalsReceived={handleProposalsReceived}
          />
        </div>

        {/* Review panel */}
        {showReview && (
          <div className="hidden md:flex md:w-[40%] border-l border-border">
            <div className="w-full">
              <ReviewPanel
                sessionId={sessionId}
                proposals={session.proposals}
                isCompleted={isCompleted}
                onProposalUpdate={handleProposalUpdate}
                onConfirm={handleConfirm}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mini-calendar — collapsible */}
      {showMiniCal && (
        <div className="border-t border-border p-3 max-w-[240px]" data-testid="mini-calendar-panel">
          <MiniCalendar proposalDates={proposalDates} />
        </div>
      )}
    </div>
  )
}
