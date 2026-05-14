'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"

interface DeleteAssetDialogProps {
  open: boolean
  filename: string
  permanent?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteAssetDialog({ open, filename, permanent, onConfirm, onCancel }: DeleteAssetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle>{permanent ? 'Permanently delete?' : 'Delete asset?'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {permanent ? (
            <>This will permanently delete <span className="text-foreground font-medium">{filename}</span>. This cannot be undone.</>
          ) : (
            <>This will move <span className="text-foreground font-medium">{filename}</span> to trash.</>
          )}
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {permanent ? 'Delete Permanently' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
