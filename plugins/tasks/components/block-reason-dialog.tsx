'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"

interface BlockReasonDialogProps {
  taskTitle: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function BlockReasonDialog({ taskTitle, onConfirm, onCancel }: BlockReasonDialogProps) {
  const [reason, setReason] = useState('')

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason.trim())
      setReason('')
    }
  }

  const handleCancel = () => {
    setReason('')
    onCancel()
  }

  return (
    <Dialog open={!!taskTitle} onOpenChange={(open) => { if (!open) handleCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Block task</DialogTitle>
          <DialogDescription>
            Why is &ldquo;{taskTitle}&rdquo; blocked?
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Waiting on API, needs design review, etc."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!reason.trim()}>
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
