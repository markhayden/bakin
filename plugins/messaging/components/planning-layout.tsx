'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { Skeleton } from "@bakin/sdk/ui"
import { AgentAvatar } from "@bakin/sdk/components"
import { ArrowLeft, PanelRight, PanelRightClose, Pencil, Check, X, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@bakin/sdk/ui"
import { SessionChat } from './session-chat'
import { ReviewPanel } from './review-panel'
import { DeleteSessionDialog } from './delete-session-dialog'
import type { PlanningSession, ProposedItem } from '../types'
import { useAgent } from "@bakin/sdk/hooks"

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const sessionAgent = useAgent(session?.agentId ?? '')

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/messaging/sessions/${sessionId}`)
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
      const res = await fetch(`/api/plugins/messaging/sessions/${sessionId}`, {
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

  const handleDeleteSession = async () => {
    try {
      await fetch(`/api/plugins/messaging/sessions/${sessionId}`, { method: 'DELETE' })
      onBack?.()
    } catch {
      // Silently fail
    }
    setShowDeleteDialog(false)
  }

  const handleProposalsReceived = useCallback((newProposals: ProposedItem[]) => {
    setSession((prev) => {
      if (!prev) return prev
      // Upsert: replace existing proposals by id, append new ones
      const updatedProposals = [...prev.proposals]
      for (const np of newProposals) {
        const idx = updatedProposals.findIndex(p => p.id === np.id)
        if (idx >= 0) {
          updatedProposals[idx] = np
        } else {
          updatedProposals.push(np)
        }
      }
      return { ...prev, proposals: updatedProposals }
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
    // Kick back to session list after a brief delay so the toast is visible
    setTimeout(() => onBack?.(), 600)
  }, [onSessionUpdated, onBack])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (session?.status === 'completed') return

      if (e.key === 'Escape') {
        onBack?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [session?.status, onBack])

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
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

  const agentId = session.agentId
  const isCompleted = session.status === 'completed'

  return (
    <div className="flex flex-col h-full" data-testid="planning-layout">
      {/* Session header */}
      <div className="flex items-center gap-3 px-3 pb-3 border-b border-border">
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
          {sessionAgent?.name || agentId}
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
          onClick={() => setShowReview(!showReview)}
          title={showReview ? 'Hide review panel' : 'Show review panel'}
        >
          {showReview ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRight className="w-4 h-4" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="h-7 w-7 p-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.06)] transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem
              onClick={() => setShowDeleteDialog(true)}
              className="text-red-400 focus:text-red-400 whitespace-nowrap"
            >
              <Trash2 className="size-3.5 mr-2 shrink-0" />
              Delete session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden gap-6 pt-5">
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

      <DeleteSessionDialog
        open={showDeleteDialog}
        title={session.title}
        onConfirm={handleDeleteSession}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  )
}
