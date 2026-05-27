'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"

interface WorkflowDeleteActionProps {
  workflowName: string
  disabled?: boolean
  deleting?: boolean
  error?: string | null
  onClearError?: () => void
  onDelete: () => boolean | void | Promise<boolean | void>
}

export function WorkflowDeleteAction({
  workflowName,
  disabled = false,
  deleting = false,
  error,
  onClearError,
  onDelete,
}: WorkflowDeleteActionProps) {
  const [open, setOpen] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && deleting) return
    setOpen(nextOpen)
    if (!nextOpen) onClearError?.()
  }

  async function handleDelete() {
    const deleted = await onDelete()
    if (deleted !== false) {
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
        aria-label="Delete workflow"
        title="Delete workflow"
        onClick={() => {
          onClearError?.()
          setOpen(true)
        }}
        disabled={disabled || deleting}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogDescription>
              This will delete the custom workflow &ldquo;{workflowName}&rdquo;. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
