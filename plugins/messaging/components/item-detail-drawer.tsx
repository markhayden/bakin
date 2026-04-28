'use client'

import { useState, useEffect } from 'react'
import { Pencil, Trash2, MoreHorizontal, Check, X, Calendar, Clock, MessageSquare, Undo2 } from 'lucide-react'
import { BakinDrawer } from "@bakin/sdk/components"
import { AgentAvatar } from "@bakin/sdk/components"
import { AgentSelect } from "@bakin/sdk/components"
import { Badge } from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Textarea } from "@bakin/sdk/ui"
import { Separator } from "@bakin/sdk/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bakin/sdk/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@bakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import type { CalendarItem, ContentTone } from '../types'
import { DEFAULT_CHANNEL } from '../types'
import { TONE_LABELS, STATUS_BADGE } from '../constants'
import { useAgent, useAgentIds } from "@bakin/sdk/hooks"
import { useContentTypes, getContentTypeLabel } from '../hooks/use-content-types'
import {
  useNotificationChannels,
  getChannelLabel,
} from "@bakin/sdk/hooks"
import { ChannelIcon } from "@bakin/sdk/components"

interface Props {
  item: CalendarItem | null
  open: boolean
  editing: boolean
  onClose: () => void
  onCancelEdit: () => void
  onEdit: () => void
  onUpdated: () => void
  onDelete: (id: string) => void
  defaultDate?: string
}

export function ItemDetailDrawer({ item, open, editing, onClose, onCancelEdit, onEdit, onUpdated, onDelete, defaultDate }: Props) {
  // Form state for create/edit
  const [title, setTitle] = useState('')
  const [agent, setAgent] = useState<string>('')
  const [contentType, setContentType] = useState<string>('post')
  const contentTypes = useContentTypes()
  const agentIds = useAgentIds()
  const itemAgent = useAgent(item?.agent ?? '')
  const availableChannels = useNotificationChannels()
  const [tone, setTone] = useState<ContentTone>('conversational')
  const [scheduledAt, setScheduledAt] = useState('')
  const [brief, setBrief] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [channels, setChannels] = useState<string[]>([DEFAULT_CHANNEL])
  const [draftCaption, setDraftCaption] = useState('')
  const [draftImagePrompt, setDraftImagePrompt] = useState('')
  const [draftVideoPrompt, setDraftVideoPrompt] = useState('')

  // Detail state
  const [rejectionNote, setRejectionNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const isCreate = editing && !item

  // Populate form when entering edit mode or creating
  useEffect(() => {
    if (!open) return
    if (editing && item) {
      // Edit existing
      setTitle(item.title)
      setAgent(item.agent)
      setContentType(item.contentType)
      setTone(item.tone)
      setScheduledAt(item.scheduledAt.slice(0, 16))
      setBrief(item.brief || '')
      setChannels(item.channels)
      setDraftCaption(item.draft?.caption || '')
      setDraftImagePrompt(item.draft?.imagePrompt || '')
      setDraftVideoPrompt(item.draft?.videoPrompt || '')
    } else if (isCreate) {
      // New item
      setTitle('')
      setAgent(agentIds[0] ?? '')
      setContentType(contentTypes[0]?.id ?? 'post')
      setTone('conversational')
      setScheduledAt(defaultDate || new Date().toISOString().slice(0, 16))
      setBrief('')
      setChannels([DEFAULT_CHANNEL])
    }
    setRejectionNote('')
    setShowRejectForm(false)
    setConfirmDelete(false)
    setDirty(false)
  }, [open, editing, item, isCreate, defaultDate, agentIds, contentTypes])

  const handleSave = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (isCreate) {
        await fetch('/api/plugins/messaging/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            agent,
            contentType,
            tone,
            scheduledAt: new Date(scheduledAt).toISOString(),
            brief: brief.trim(),
            channels,
            status: 'draft',
          }),
        })
      } else if (item) {
        const updates: Record<string, unknown> = {
          title: title.trim(),
          agent,
          contentType,
          tone,
          channels,
          scheduledAt: new Date(scheduledAt).toISOString(),
          brief: brief.trim(),
        }
        // Include draft fields if item has a draft or any draft field is filled
        if (item.draft || draftCaption || draftImagePrompt || draftVideoPrompt) {
          updates.draft = {
            ...item.draft,
            caption: draftCaption,
            imagePrompt: draftImagePrompt,
            videoPrompt: draftVideoPrompt,
          }
        }
        await fetch(`/api/plugins/messaging/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      }
      onUpdated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    if (!item) return
    setActionLoading(true)
    try {
      await fetch(`/api/plugins/messaging/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      onUpdated()
      onClose()
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnapprove = async () => {
    if (!item) return
    setActionLoading(true)
    try {
      await fetch(`/api/plugins/messaging/${item.id}/unapprove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      onUpdated()
      onClose()
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!item) return
    setActionLoading(true)
    try {
      await fetch(`/api/plugins/messaging/${item.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: rejectionNote }),
      })
      onUpdated()
      onClose()
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteClick = () => {
    setConfirmDelete(true)
  }

  const handleConfirmDelete = () => {
    if (item) {
      onDelete(item.id)
      onClose()
    }
    setConfirmDelete(false)
  }

  // ─── Edit/Create Form ──────────────────────────────────────────
  if (editing) {
    return (
      <BakinDrawer
        open={open}
        onOpenChange={(o) => { if (!o) onClose() }}
        title={isCreate ? 'New Calendar Item' : 'Edit Item'}
        onBack={isCreate ? undefined : onCancelEdit}
        dirty={dirty}
      >
        <div className="space-y-5">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
              placeholder="Post title..."
              className="bg-surface"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Agent</label>
              <AgentSelect
                value={agent}
                onValueChange={(v) => { setAgent(v ?? ''); setDirty(true) }}
                agentIds={agentIds}
                className="bg-surface"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Content Type</label>
              <Select value={contentType} onValueChange={(v) => { setContentType(v ?? contentTypes[0]?.id ?? 'post'); setDirty(true) }}>
                <SelectTrigger className="bg-surface">
                  <SelectValue>{getContentTypeLabel(contentType, contentTypes)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map(({ id, label }) => (
                    <SelectItem key={id} value={id}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tone</label>
              <Select value={tone} onValueChange={(v) => { setTone(v as ContentTone); setDirty(true) }}>
                <SelectTrigger className="bg-surface">
                  <SelectValue>{TONE_LABELS[tone]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TONE_LABELS) as [ContentTone, string][]).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Scheduled Date/Time</label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => { setScheduledAt(e.target.value); setDirty(true) }}
                className="bg-surface"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Channels</label>
            <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-border bg-surface min-h-[38px]">
              {availableChannels.map((c) => {
                const active = channels.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setChannels(prev =>
                        active ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      )
                      setDirty(true)
                    }}
                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors cursor-pointer ${
                      active
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                    }`}
                  >
                    <ChannelIcon channelId={c.id} className="size-3.5" />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Brief</label>
            <Textarea
              value={brief}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setBrief(e.target.value); setDirty(true) }}
              placeholder="Full description/instructions for the agent..."
              className="bg-surface min-h-[100px]"
            />
          </div>

          {/* Draft fields — only show when item has draft content or is being edited */}
          {item?.draft !== undefined && (
            <>
              <Separator />
              <h3 className="text-sm font-medium">Draft Content</h3>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Caption</label>
                <Textarea
                  value={draftCaption}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setDraftCaption(e.target.value); setDirty(true) }}
                  placeholder="Post caption..."
                  className="bg-surface min-h-[80px]"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Image Prompt</label>
                <Textarea
                  value={draftImagePrompt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setDraftImagePrompt(e.target.value); setDirty(true) }}
                  placeholder="Image generation prompt..."
                  className="bg-surface min-h-[60px]"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Video Prompt</label>
                <Textarea
                  value={draftVideoPrompt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setDraftVideoPrompt(e.target.value); setDirty(true) }}
                  placeholder="Video generation prompt..."
                  className="bg-surface min-h-[60px]"
                />
              </div>

              {item?.draft?.agentNotes && (
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Agent Notes (read-only)</label>
                  <p className="text-sm text-muted-foreground bg-surface rounded-lg p-3 italic">
                    {item.draft.agentNotes}
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={isCreate ? onClose : onCancelEdit}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? 'Saving...' : isCreate ? 'Create Item' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </BakinDrawer>
    )
  }

  // ─── Detail View ────────────────────────────────────────────────
  if (!item) return null

  const scheduledDate = new Date(item.scheduledAt)

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setConfirmDelete(false)
          setShowRejectForm(false)
        }
      }}
      title={item.title}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDeleteClick}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="size-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-6">
        {/* Agent hero */}
        <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
          <AgentAvatar agentId={item.agent} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{itemAgent?.name ?? item.agent}</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={STATUS_BADGE[item.status]}>
                {item.status === 'waiting'
                  ? `waiting: ${item.draft?.videoPrompt ? 'video' : 'image'}`
                  : item.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {scheduledDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' at '}
                {scheduledDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Edit
          </Button>
          {item.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={handleApprove} disabled={actionLoading}>
              <Check className="size-3.5 mr-1.5" /> Schedule
            </Button>
          )}
          {item.status === 'scheduled' && (
            <Button variant="outline" size="sm" onClick={handleUnapprove} disabled={actionLoading}>
              <Undo2 className="size-3.5 mr-1.5" /> Unapprove
            </Button>
          )}
          {item.status === 'review' && (
            <>
              <Button variant="outline" size="sm" onClick={handleApprove} disabled={actionLoading}>
                <Check className="size-3.5 mr-1.5" /> Approve & Publish
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowRejectForm(!showRejectForm)} disabled={actionLoading}>
                <X className="size-3.5 mr-1.5" /> Reject
              </Button>
            </>
          )}
        </div>

        {/* Reject form */}
        {showRejectForm && (
          <div className="space-y-2">
            <Textarea
              placeholder="Rejection note (optional)..."
              value={rejectionNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionNote(e.target.value)}
              className="bg-surface"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowRejectForm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={actionLoading}>
                Confirm Reject
              </Button>
            </div>
          </div>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
              <Calendar className="size-3" />
              Date
            </div>
            <div className="text-sm font-medium">
              {scheduledDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
              <Clock className="size-3" />
              Time
            </div>
            <div className="text-sm font-medium">
              {scheduledDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Type</div>
            <div className="text-sm font-medium">{getContentTypeLabel(item.contentType, contentTypes)}</div>
          </div>
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Tone</div>
            <div className="text-sm font-medium">{TONE_LABELS[item.tone]}</div>
          </div>
          <div className="rounded-lg bg-surface p-3 space-y-1 col-span-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
              <MessageSquare className="size-3" />
              Channels
            </div>
            <div className="flex items-center gap-2 text-sm font-medium">
              {item.channels.map(ch => (
                <Badge key={ch} variant="outline" className="text-[10px] inline-flex items-center gap-1">
                  <ChannelIcon channelId={ch} className="size-3" />
                  {getChannelLabel(ch, availableChannels)}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Brief */}
        <div>
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">Brief</h3>
          <div
            className="text-sm text-foreground/90 leading-relaxed rounded-lg p-4 border-l-2 bg-surface"
            style={{ borderLeftColor: `var(--agent-${item.agent})` }}
          >
            {item.brief || <span className="text-muted-foreground italic">No brief provided</span>}
          </div>
        </div>

        {/* Draft content */}
        {item.draft && (
          <>
            <Separator />
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Draft Content</h3>

              {item.draft.caption && (
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Caption</h4>
                  <p className="text-sm text-foreground bg-surface rounded-lg p-3 whitespace-pre-wrap">
                    {item.draft.caption}
                  </p>
                </div>
              )}

              {item.draft.imageFilename && (
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Image</h4>
                  <img
                    src={`/api/assets/${encodeURIComponent(item.draft.imageFilename)}`}
                    alt="Draft"
                    className="rounded-lg max-h-64 object-cover"
                  />
                </div>
              )}

              {item.draft.videoFilename && (
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Video</h4>
                  <video
                    src={`/api/assets/${encodeURIComponent(item.draft.videoFilename)}`}
                    controls
                    className="rounded-lg max-h-64"
                  />
                </div>
              )}

              {item.draft.agentNotes && (
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Agent Notes</h4>
                  <p className="text-sm text-muted-foreground bg-surface rounded-lg p-3 italic">
                    {item.draft.agentNotes}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Rejection note */}
        {item.rejectionNote && (
          <>
            <Separator />
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <h3 className="text-sm font-medium text-red-400 mb-1">Previous Rejection Note</h3>
              <p className="text-sm text-red-300">{item.rejectionNote}</p>
            </div>
          </>
        )}

        <Dialog
          open={confirmDelete}
          onOpenChange={(v) => { if (!v) setConfirmDelete(false) }}
        >
          <DialogContent className="bg-card border-border max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete this item?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="text-foreground font-medium">{item.title}</span>
              {item.status === 'scheduled' && ' and cancel its scheduled delivery'}. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)} className="cursor-pointer">
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete} className="cursor-pointer">
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </BakinDrawer>
  )
}
