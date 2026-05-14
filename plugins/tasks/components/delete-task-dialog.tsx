'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"

interface DeleteTaskDialogProps {
  title: { id: string; title: string } | null
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteTaskDialog({ title: target, onConfirm, onCancel }: DeleteTaskDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="bg-card border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete task</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{target?.title}&rdquo;? This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
