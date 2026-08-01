'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import {
  Dialog,
  DialogContent,
  type DialogContentProps,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog'

export interface UnsavedChangesDialogProps {
  open: boolean
  busy?: boolean
  canSaveInPlace?: boolean
  saveDisabled?: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  saveLabel?: string
  busyLabel?: string
  discardLabel?: string
  cancelLabel?: string
  /** Focus destination after a controlled exit decision closes. */
  finalFocus?: DialogContentProps['finalFocus']
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Three-way exit decision used by router-aware dirty-state guards. */
export function UnsavedChangesDialog({
  open,
  busy = false,
  canSaveInPlace = true,
  saveDisabled = false,
  title = 'Unsaved changes',
  description = 'Save before leaving, discard the draft, or stay on this page.',
  error,
  saveLabel = 'Save and exit',
  busyLabel = 'Saving…',
  discardLabel = 'Discard changes',
  cancelLabel = 'Cancel',
  finalFocus,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={open}
      busy={busy}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent data-unsaved-changes-dialog="" className="max-w-lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div
            role="alert"
            data-slot="unsaved-changes-error"
            className="rounded-bakin-control border border-bakin-signal-danger/60 bg-bakin-signal-danger/10 px-bakin-3 py-bakin-2 text-bakin-text-primary"
          >
            {error}
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button variant="danger" onClick={onDiscard} disabled={busy}>
            {discardLabel}
          </Button>
          <div className="flex min-w-0 flex-col-reverse gap-bakin-2 sm:flex-row">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            {canSaveInPlace ? (
              <Button onClick={onSave} disabled={busy || saveDisabled}>
                {busy ? (
                  <span
                    aria-hidden="true"
                    className="size-bakin-3 animate-spin rounded-bakin-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
                  />
                ) : null}
                {busy ? busyLabel : saveLabel}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
