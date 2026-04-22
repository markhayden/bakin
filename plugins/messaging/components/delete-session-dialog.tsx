'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"

interface DeleteSessionDialogProps {
  open: boolean
  title: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteSessionDialog({ open, title, onConfirm, onCancel }: DeleteSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will permanently delete <span className="text-foreground font-medium">{title}</span> and all its messages and proposals. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
