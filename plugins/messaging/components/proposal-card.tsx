'use client'

import { useState } from 'react'
import { Button } from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Check, X, Pencil } from 'lucide-react'
import type { ProposedItem, ProposalStatus } from '../types'

const STATUS_STYLES: Record<ProposalStatus, { label: string; className: string }> = {
  proposed: { label: 'Proposed', className: 'bg-muted text-muted-foreground' },
  approved: { label: 'Approved', className: 'bg-emerald-500/20 text-emerald-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/20 text-red-400 opacity-60' },
  revised: { label: 'Revised', className: 'bg-amber-500/20 text-amber-400' },
}

interface Props {
  proposal: ProposedItem
  onApprove?: (id: string) => void
  onReject?: (id: string, note: string) => void
  onEdit?: (id: string) => void
  onTitleChange?: (id: string, title: string) => void
}

export function ProposalCard({ proposal, onApprove, onReject, onEdit, onTitleChange }: Props) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectionNote, setRejectionNote] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(proposal.title)

  const statusStyle = STATUS_STYLES[proposal.status]
  const canAct = proposal.status === 'proposed' || proposal.status === 'revised'

  const handleReject = () => {
    if (onReject) {
      onReject(proposal.id, rejectionNote)
      setShowRejectInput(false)
      setRejectionNote('')
    }
  }

  return (
    <div
      className={`border rounded-lg p-3 ${
        proposal.status === 'rejected' ? 'border-red-500/30 bg-red-500/5 opacity-60' :
        proposal.status === 'approved' ? 'border-emerald-500/50 bg-emerald-500/5' :
        'border-border bg-card'
      }`}
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editingTitle && canAct && onTitleChange ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="h-6 text-xs font-medium"
              data-testid="title-input"
              autoFocus
              onBlur={() => {
                if (titleDraft.trim() && titleDraft !== proposal.title) {
                  onTitleChange(proposal.id, titleDraft.trim())
                }
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (titleDraft.trim() && titleDraft !== proposal.title) {
                    onTitleChange(proposal.id, titleDraft.trim())
                  }
                  setEditingTitle(false)
                }
                if (e.key === 'Escape') {
                  setTitleDraft(proposal.title)
                  setEditingTitle(false)
                }
              }}
            />
          ) : (
            <h4
              className={`font-medium text-xs truncate ${canAct && onTitleChange ? 'cursor-pointer hover:underline' : ''}`}
              onClick={() => {
                if (canAct && onTitleChange) {
                  setTitleDraft(proposal.title)
                  setEditingTitle(true)
                }
              }}
              data-testid="proposal-title"
            >
              {proposal.title}
            </h4>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground">
              {new Date(proposal.scheduledAt).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 px-1">
              {proposal.contentType}
            </Badge>
            <Badge variant="outline" className="text-[10px] py-0 px-1">
              {proposal.tone}
            </Badge>
            {proposal.channels?.map((ch) => (
              <Badge key={ch} variant="outline" className="text-[10px] py-0 px-1">
                {ch}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{proposal.brief}</p>
          {proposal.rejectionNote && (
            <p className="text-[11px] text-red-400 mt-1 italic">
              Note: {proposal.rejectionNote}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Badge className={statusStyle.className + ' text-[10px]'}>
            {statusStyle.label}
          </Badge>

          {canAct && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-emerald-400 hover:text-emerald-300"
                onClick={(e) => { e.stopPropagation(); onApprove?.(proposal.id) }}
                title="Approve"
              >
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                onClick={(e) => { e.stopPropagation(); setShowRejectInput(!showRejectInput) }}
                title="Reject"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); onEdit?.(proposal.id) }}
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {showRejectInput && (
        <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Input
            value={rejectionNote}
            onChange={(e) => setRejectionNote(e.target.value)}
            placeholder="Rejection note (optional)"
            className="text-xs h-7"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleReject()
              if (e.key === 'Escape') {
                setShowRejectInput(false)
                setRejectionNote('')
              }
            }}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReject}>
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}
