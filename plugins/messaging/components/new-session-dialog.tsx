'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AgentAvatar } from '@/components/agent-avatar'
import { AGENT_INFO } from '../types'
import type { ContentAgent } from '../types'

interface NewSessionDialogProps {
  open: boolean
  agentId: ContentAgent | null
  onConfirm: (agentId: string, title: string) => void
  onCancel: () => void
}

export function NewSessionDialog({ open, agentId, onConfirm, onCancel }: NewSessionDialogProps) {
  const [title, setTitle] = useState('')
  const agentInfo = agentId ? AGENT_INFO[agentId] : null

  // Reset when dialog opens
  useEffect(() => {
    if (open) setTitle('')
  }, [open])

  const handleSubmit = () => {
    if (!agentId) return
    onConfirm(agentId, title.trim() || 'New planning session')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
        </DialogHeader>
        {agentInfo && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AgentAvatar agentId={agentId!} size="xs" />
            <span>Planning with {agentInfo.name}</span>
          </div>
        )}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Session name..."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="flex justify-end gap-2 mt-1">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Start Session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
