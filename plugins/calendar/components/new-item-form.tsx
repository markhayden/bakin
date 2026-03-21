'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ContentAgent, ContentType, ContentTone } from '../types'
import { AGENT_INFO, DISCORD_GENERAL } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  defaultDate?: Date
}

export function NewItemForm({ open, onClose, onCreated, defaultDate }: Props) {
  const [title, setTitle] = useState('')
  const [agent, setAgent] = useState<ContentAgent>('chef')
  const [contentType, setContentType] = useState<ContentType>('tip')
  const [tone, setTone] = useState<ContentTone>('conversational')
  const [scheduledAt, setScheduledAt] = useState(
    defaultDate ? defaultDate.toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16)
  )
  const [brief, setBrief] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSaving(true)
    try {
      const res = await fetch('/api/plugins/calendar/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          agent,
          contentType,
          tone,
          scheduledAt: new Date(scheduledAt).toISOString(),
          brief: brief.trim(),
          channel: 'discord',
          channelTarget: DISCORD_GENERAL,
          status: 'draft',
        }),
      })
      if (res.ok) {
        onCreated()
        onClose()
        // Reset form
        setTitle('')
        setBrief('')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle>New Calendar Item</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post title..."
              className="bg-surface"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Agent</label>
              <Select value={agent} onValueChange={(v) => setAgent(v as ContentAgent)}>
                <SelectTrigger className="bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AGENT_INFO) as ContentAgent[]).map((a) => (
                    <SelectItem key={a} value={a}>
                      {AGENT_INFO[a].emoji} {AGENT_INFO[a].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Content Type</label>
              <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
                <SelectTrigger className="bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recipe">Recipe</SelectItem>
                  <SelectItem value="tip">Tip</SelectItem>
                  <SelectItem value="motivation">Motivation</SelectItem>
                  <SelectItem value="workout">Workout</SelectItem>
                  <SelectItem value="outdoor">Outdoor</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="image-post">Image Post</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tone</label>
              <Select value={tone} onValueChange={(v) => setTone(v as ContentTone)}>
                <SelectTrigger className="bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="energetic">Energetic</SelectItem>
                  <SelectItem value="calm">Calm</SelectItem>
                  <SelectItem value="educational">Educational</SelectItem>
                  <SelectItem value="humorous">Humorous</SelectItem>
                  <SelectItem value="inspiring">Inspiring</SelectItem>
                  <SelectItem value="conversational">Conversational</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Scheduled Date/Time</label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="bg-surface"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Brief</label>
            <Textarea
              value={brief}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief(e.target.value)}
              placeholder="Full description/instructions for the agent..."
              className="bg-surface min-h-[100px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? 'Creating...' : 'Create Item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
