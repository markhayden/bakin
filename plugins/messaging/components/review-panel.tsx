'use client'

import { useState, useMemo } from 'react'
import { Button } from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Textarea } from "@bakin/sdk/ui"
import { Label } from "@bakin/sdk/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bakin/sdk/ui"
import { BakinDrawer } from "@bakin/sdk/components"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import { Check, CheckCircle, Loader2, X } from 'lucide-react'
import { toast } from "@bakin/sdk/hooks"
import { ProposalCard } from './proposal-card'
import type { ContentTone, ProposedItem } from '../types'
import { TONE_LABELS } from '../constants'
import { useContentTypes, getContentTypeLabel } from '../hooks/use-content-types'

interface Props {
  sessionId: string
  proposals: ProposedItem[]
  isCompleted?: boolean
  onProposalUpdate?: (updatedProposal: ProposedItem) => void
  onConfirm?: (result: { itemsCreated: number; itemIds: string[] }) => void
}

export function ReviewPanel({
  sessionId,
  proposals,
  isCompleted = false,
  onProposalUpdate,
  onConfirm,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [editingProposal, setEditingProposal] = useState<ProposedItem | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    brief: '',
    scheduledAt: '',
    contentType: '',
    tone: '',
  })
  const [drawerRejectNote, setDrawerRejectNote] = useState('')
  const [showDrawerReject, setShowDrawerReject] = useState(false)
  const contentTypes = useContentTypes()

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
        `/api/plugins/messaging/sessions/${sessionId}/proposals/${proposalId}`,
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
        `/api/plugins/messaging/sessions/${sessionId}/proposals/${proposalId}`,
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

  const handleUndoDecision = async (proposalId: string) => {
    try {
      const res = await fetch(
        `/api/plugins/messaging/sessions/${sessionId}/proposals/${proposalId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'proposed', rejectionNote: '' }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        onProposalUpdate?.(data.proposal)
        setEditingProposal((prev) =>
          prev && prev.id === data.proposal.id ? data.proposal : prev
        )
      }
    } catch {
      // Silently fail
    }
  }

  const handleConfirm = async (autoApprove: boolean) => {
    setShowConfirmDialog(false)
    setConfirming(true)
    try {
      const res = await fetch(`/api/plugins/messaging/sessions/${sessionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApprove }),
      })
      if (res.ok) {
        const data = await res.json()
        setConfirmed(true)
        const count = data.itemsCreated ?? approvedCount
        const destination = autoApprove ? 'scheduled on calendar' : 'added as drafts'
        toast(`${count} ${count === 1 ? 'item' : 'items'} ${destination}`, 'success')
        onConfirm?.(data)
      }
    } catch {
      toast('Failed to confirm plan', 'error')
    } finally {
      setConfirming(false)
    }
  }

  const handleOpenEdit = (proposalId: string) => {
    const p = proposals.find((pr) => pr.id === proposalId)
    if (!p) return
    setEditingProposal(p)
    setEditForm({
      title: p.title,
      brief: p.brief,
      scheduledAt: p.scheduledAt.slice(0, 16), // trim to datetime-local format
      contentType: p.contentType,
      tone: p.tone,
    })
    setShowDrawerReject(false)
    setDrawerRejectNote('')
  }

  const handleEditSave = async () => {
    if (!editingProposal) return
    try {
      const res = await fetch(
        `/api/plugins/messaging/sessions/${sessionId}/proposals/${editingProposal.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editForm),
        }
      )
      if (res.ok) {
        const data = await res.json()
        onProposalUpdate?.(data.proposal)
        setEditingProposal(null)
      }
    } catch {
      // Silently fail
    }
  }

  const handleTitleChange = async (proposalId: string, title: string) => {
    try {
      const res = await fetch(
        `/api/plugins/messaging/sessions/${sessionId}/proposals/${proposalId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
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
                  onClick={() => {
                    if (!isCompleted && !confirmed) {
                      handleOpenEdit(proposal.id)
                    }
                  }}
                  className={!isCompleted && !confirmed ? 'cursor-pointer' : ''}
                >
                  <ProposalCard
                    proposal={proposal}
                    onApprove={!isCompleted && !confirmed ? handleApprove : undefined}
                    onReject={!isCompleted && !confirmed ? handleReject : undefined}
                    onEdit={!isCompleted && !confirmed ? () => handleOpenEdit(proposal.id) : undefined}
                    onTitleChange={!isCompleted && !confirmed ? handleTitleChange : undefined}
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
            onClick={() => setShowConfirmDialog(true)}
            disabled={approvedCount === 0 || confirming}
            className="w-full cursor-pointer"
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

      {/* Confirm dialog — auto-approve choice */}
      <Dialog
        open={showConfirmDialog}
        onOpenChange={(v) => { if (!v) setShowConfirmDialog(false) }}
      >
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm {approvedCount} {approvedCount === 1 ? 'item' : 'items'}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Auto-approve and schedule these on your calendar, or add them as drafts
            so you can review each one individually before they go live?
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirm(false)} className="cursor-pointer">
              Add as drafts
            </Button>
            <Button onClick={() => handleConfirm(true)} className="cursor-pointer">
              Auto-approve &amp; schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit drawer */}
      <BakinDrawer
        open={!!editingProposal}
        onOpenChange={(open) => { if (!open) setEditingProposal(null) }}
        title="Edit Proposal"
        defaultWidth={480}
        storageKey="proposal-edit"
      >
        {editingProposal && (
          <div className="flex flex-col h-full -mx-7 -mb-6">
            <div className="flex-1 overflow-y-auto px-7 pt-1 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-brief">Brief</Label>
                <Textarea
                  id="edit-brief"
                  value={editForm.brief}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setEditForm((f) => ({ ...f, brief: e.target.value }))
                  }
                  className="min-h-[300px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-scheduledAt">Scheduled At</Label>
                <Input
                  id="edit-scheduledAt"
                  type="datetime-local"
                  value={editForm.scheduledAt}
                  onChange={(e) => setEditForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-contentType">Content Type</Label>
                  <Select
                    value={editForm.contentType}
                    onValueChange={(v) =>
                      setEditForm((f) => ({ ...f, contentType: v ?? f.contentType }))
                    }
                  >
                    <SelectTrigger id="edit-contentType" className="w-full">
                      <SelectValue>
                        {getContentTypeLabel(editForm.contentType, contentTypes)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {contentTypes.map(({ id, label }) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-tone">Tone</Label>
                  <Select
                    value={editForm.tone}
                    onValueChange={(v) =>
                      setEditForm((f) => ({ ...f, tone: (v as ContentTone) ?? f.tone }))
                    }
                  >
                    <SelectTrigger id="edit-tone" className="w-full">
                      <SelectValue>
                        {TONE_LABELS[editForm.tone as ContentTone] ?? editForm.tone}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(TONE_LABELS) as [ContentTone, string][]).map(([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Approve / Reject — proposal status actions */}
              {(editingProposal.status === 'proposed' || editingProposal.status === 'revised') && (
                <div className="mt-6 pt-6 border-t border-border space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Once you&apos;re happy with the details, approve this proposal to add it to your calendar.
                    Reject it to send feedback back to the agent for revision.
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button
                      variant="outline"
                      className="px-8 text-red-400 border-red-500/30 hover:bg-red-500/10 cursor-pointer"
                      onClick={() => setShowDrawerReject(true)}
                      title="Reject"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      className="px-8 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 cursor-pointer"
                      onClick={() => {
                        handleApprove(editingProposal.id)
                        setEditingProposal(null)
                      }}
                      title="Approve"
                    >
                      <Check className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                  </div>
                </div>
              )}

              {/* Undo — when proposal is already approved or rejected */}
              {(editingProposal.status === 'approved' || editingProposal.status === 'rejected') && (
                <div className="mt-6 pt-6 border-t border-border space-y-3">
                  <p className="text-xs text-muted-foreground">
                    This proposal is {editingProposal.status}. Changed your mind? Undo to return it to
                    the review queue so you can approve or reject again.
                  </p>
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      className="px-8 cursor-pointer"
                      onClick={() => handleUndoDecision(editingProposal.id)}
                      title="Undo decision"
                    >
                      Undo {editingProposal.status === 'approved' ? 'approval' : 'rejection'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Reject input */}
              {showDrawerReject && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label htmlFor="drawer-reject-note">Rejection Note (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="drawer-reject-note"
                      value={drawerRejectNote}
                      onChange={(e) => setDrawerRejectNote(e.target.value)}
                      placeholder="What should change?"
                      className="text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleReject(editingProposal.id, drawerRejectNote)
                          setEditingProposal(null)
                        }
                        if (e.key === 'Escape') setShowDrawerReject(false)
                      }}
                      autoFocus
                    />
                    <Button
                      variant="destructive"
                      onClick={() => {
                        handleReject(editingProposal.id, drawerRejectNote)
                        setEditingProposal(null)
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer — Save Changes only */}
            <div className="shrink-0 border-t border-border bg-background px-7 py-4">
              <Button onClick={handleEditSave} className="w-full cursor-pointer">
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </BakinDrawer>
    </div>
  )
}
