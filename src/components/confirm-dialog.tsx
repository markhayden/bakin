'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ConfirmDialogProps {
  /** Whether the dialog is shown. Controlled by the caller (e.g. `open={!!target}`). */
  open: boolean
  title: ReactNode
  /** Body copy. Rendered inside DialogDescription (a `<p>`) — pass inline content; use `<span className="block">` for secondary lines. */
  description?: ReactNode
  /** Confirm button label (default "Delete"). */
  confirmLabel?: string
  /** Confirm label while busy (default = confirmLabel); a spinner is prepended. */
  busyLabel?: string
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string
  /** Cancel button variant (default "outline"). */
  cancelVariant?: 'outline' | 'ghost'
  /** Disables both buttons and shows a spinner on confirm while the action is in flight. */
  busy?: boolean
  /** Inline error shown above the footer. */
  error?: string | null
  /** Test id forwarded to the confirm button. */
  confirmTestId?: string
  /** DialogContent className override (default width is `sm:max-w-sm`). */
  className?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A controlled confirmation dialog for destructive actions — the consolidation of
 * six near-identical hand-rolled delete dialogs. The caller owns visibility (`open`)
 * and the busy/error state of the in-flight action; the dialog never closes itself
 * while `busy` so an action can't be cancelled mid-flight.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busyLabel,
  cancelLabel = 'Cancel',
  cancelVariant = 'outline',
  busy = false,
  error,
  confirmTestId,
  className,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className={cn('bg-card border-border sm:max-w-sm', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant={cancelVariant} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy} data-testid={confirmTestId}>
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                {busyLabel ?? confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
