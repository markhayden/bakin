'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Loader2 } from 'lucide-react'
import { ProposalCard } from './proposal-card'
import type { ProposedItem } from '../types'

interface Props {
  sessionId: string
  proposals: ProposedItem[]
  isCompleted?: boolean
  onProposalUpdate?: (updatedProposal: ProposedItem) => void
  onConfirm?: (result: { itemsCreated: number; itemIds: string[] }) => void
  onScrollToMessage?: (messageId: string) => void
  onEditProposal?: (proposalId: string) => void
}

export function ReviewPanel({
  sessionId,
  proposals,
  isCompleted = false,
  onProposalUpdate,
  onConfirm,
  onScrollToMessage,
  onEditProposal,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const approvedCount = useMemo(
    () => proposals.filter((p) => p.status === 'approved').length,
    [proposals]
  )

  const proposalsByDate = useMemo(() => {
    const groups: Record<string, ProposedItem[]> = {}
    for (const p of proposals) {
      const date = new Date(p.scheduledAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
      if (!groups[date]) groups[date] = []
      groups[date].push(p)
    }
    // Sort groups chronologically
    return Object.entries(groups).sort(
      ([, a], [, b]) =>
        new Date(a[0].scheduledAt).getTime() - new Date(b[0].scheduledAt).getTime()
    )
  }, [proposals])

  const handleApprove = async (proposalId: string) => {
    try {
      const res = await fetch(
        `/api/plugins/calendar/sessions/${sessionId}/proposals/${proposalId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        onProposalUpdate?.(data.proposal)
      }
    } catch {
      // Silently fail — UI stays unchanged
    }
  }

  const handleReject = async (proposalId: string, note: string) => {
    try {
      const res = await fetch(
        `/api/plugins/calendar/sessions/${sessionId}/proposals/${proposalId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'rejected', rejectionNote: note || undefined }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        onProposalUpdate?.(data.proposal)
      }
    } catch {
      // Silently fail
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const res = await fetch(`/api/plugins/calendar/sessions/${sessionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        setConfirmed(true)
        onConfirm?.(data)
      }
    } catch {
      // Error handling
    } finally {
      setConfirming(false)
    }
  }

  if (proposals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-16 px-4">
        <p className="text-sm">No proposals yet</p>
        <p className="text-xs mt-1">Send a message to start brainstorming</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Review</h3>
          <Badge variant="outline" className="text-[10px]">
            {approvedCount}/{proposals.length} approved
          </Badge>
        </div>
      </div>

      {/* Proposals grouped by date */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {proposalsByDate.map(([date, dateProposals]) => (
          <div key={date}>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {date}
            </h4>
            <div className="space-y-2">
              {dateProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  onClick={() => onScrollToMessage?.(proposal.messageId)}
                  className="cursor-pointer"
                >
                  <ProposalCard
                    proposal={proposal}
                    onApprove={!isCompleted && !confirmed ? handleApprove : undefined}
                    onReject={!isCompleted && !confirmed ? handleReject : undefined}
                    onEdit={!isCompleted && !confirmed ? () => onEditProposal?.(proposal.id) : undefined}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Confirm button */}
      {!isCompleted && !confirmed && (
        <div className="p-3 border-t border-border">
          <Button
            onClick={handleConfirm}
            disabled={approvedCount === 0 || confirming}
            className="w-full"
          >
            {confirming ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm Plan ({approvedCount} items)
              </>
            )}
          </Button>
        </div>
      )}

      {(isCompleted || confirmed) && (
        <div className="p-3 border-t border-border text-center">
          <Badge className="bg-emerald-500/20 text-emerald-400">
            Plan confirmed — {approvedCount} items created
          </Badge>
        </div>
      )}
    </div>
  )
}
