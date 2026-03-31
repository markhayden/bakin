'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Check, X, Clock, Calendar } from 'lucide-react'
import type { CalendarItem, ContentStatus } from '../types'
import { AGENT_INFO } from '../types'

interface Props {
  item: CalendarItem | null
  onClose: () => void
  onUpdated: () => void
}

const STATUS_BADGE: Record<ContentStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  scheduled: 'bg-sky-500/20 text-sky-400',
  executing: 'bg-amber-500/20 text-amber-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  review: 'bg-yellow-500/20 text-yellow-300',
  published: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
}

export function ItemDetailPanel({ item, onClose, onUpdated }: Props) {
  const [rejectionNote, setRejectionNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!item) return null

  const agentInfo = AGENT_INFO[item.agent]
  const scheduledDate = new Date(item.scheduledAt)

  const handleApprove = async () => {
    setLoading(true)
    try {
      await fetch('/api/plugins/calendar/items/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      onUpdated()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    try {
      await fetch('/api/plugins/calendar/items/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, note: rejectionNote }),
      })
      onUpdated()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{agentInfo.emoji}</span>
            <div>
              <DialogTitle className="text-xl">{item.title}</DialogTitle>
              <p className="text-sm text-muted-foreground">{agentInfo.name}</p>
            </div>
            <Badge className={`ml-auto ${STATUS_BADGE[item.status]}`}>
              {item.status === 'waiting'
                ? `waiting: ${item.draft?.videoPrompt ? 'video' : 'image'}`
                : item.status}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Schedule info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {scheduledDate.toLocaleDateString()}
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <Badge variant="outline" className="text-xs">
              {item.contentType}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {item.tone}
            </Badge>
          </div>

          {/* Brief */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Brief</h3>
            <p className="text-sm text-foreground bg-surface rounded-lg p-3 whitespace-pre-wrap">
              {item.brief || 'No brief provided'}
            </p>
          </div>

          {/* Draft content (if exists) */}
          {item.draft && (
            <>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">Draft Caption</h3>
                <p className="text-sm text-foreground bg-surface rounded-lg p-3 whitespace-pre-wrap">
                  {item.draft.caption}
                </p>
              </div>

              {item.draft.imagePath && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Image</h3>
                  <img
                    src={`/api/assets/${item.draft.imagePath}`}
                    alt="Draft"
                    className="rounded-lg max-h-64 object-cover"
                  />
                </div>
              )}

              {item.draft.videoPath && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Video</h3>
                  <video
                    src={`/api/assets/${item.draft.videoPath}`}
                    controls
                    className="rounded-lg max-h-64"
                  />
                </div>
              )}

              {item.draft.agentNotes && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Agent Notes</h3>
                  <p className="text-sm text-muted-foreground bg-surface rounded-lg p-3 italic">
                    {item.draft.agentNotes}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Rejection note if previously rejected */}
          {item.rejectionNote && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <h3 className="text-sm font-medium text-red-400 mb-1">Previous Rejection Note</h3>
              <p className="text-sm text-red-300">{item.rejectionNote}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            {item.status === 'draft' && (
              <Button onClick={handleApprove} disabled={loading}>
                <Check className="w-4 h-4 mr-1.5" />
                Schedule
              </Button>
            )}

            {item.status === 'review' && (
              <>
                {showRejectForm ? (
                  <div className="flex-1 space-y-2">
                    <Textarea
                      placeholder="Rejection note (optional)..."
                      value={rejectionNote}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionNote(e.target.value)}
                      className="bg-surface"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setShowRejectForm(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleReject}
                        disabled={loading}
                      >
                        Confirm Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setShowRejectForm(true)}
                      disabled={loading}
                    >
                      <X className="w-4 h-4 mr-1.5" />
                      Reject
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={loading}
                    >
                      <Check className="w-4 h-4 mr-1.5" />
                      Approve & Publish
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
