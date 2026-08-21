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
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils'

export type ConfirmDialogTone = 'danger' | 'primary'
export type ConfirmDialogCancelVariant = 'outline' | 'ghost'

export interface ConfirmDialogProps {
  open: boolean
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  busyLabel?: string
  cancelLabel?: string
  cancelVariant?: ConfirmDialogCancelVariant
  confirmTone?: ConfirmDialogTone
  /** @deprecated Use confirmTone. Retained while official consumers migrate. */
  confirmVariant?: 'destructive' | 'default'
  busy?: boolean
  error?: React.ReactNode
  confirmTestId?: string
  className?: string
  /** Focus destination after a controlled dialog closes. Pass the external trigger ref. */
  finalFocus?: DialogContentProps['finalFocus']
  confirmValue?: string
  confirmPrompt?: React.ReactNode
  children?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}

function confirmButtonVariant(
  tone: ConfirmDialogTone | undefined,
  legacy: ConfirmDialogProps['confirmVariant'],
): 'danger' | 'primary' {
  if (tone) return tone
  return legacy === 'default' ? 'primary' : 'danger'
}

function BusySignal() {
  return <Spinner size="sm" data-slot="action-busy-signal" />
}

/** Controlled confirmation for consequential work, including exact typed confirmation. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busyLabel,
  cancelLabel = 'Cancel',
  cancelVariant = 'outline',
  confirmTone,
  confirmVariant,
  busy = false,
  error,
  confirmTestId,
  className,
  finalFocus,
  confirmValue,
  confirmPrompt,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const inputId = React.useId()
  const [typed, setTyped] = React.useState('')

  React.useEffect(() => {
    setTyped('')
  }, [open, confirmValue])

  const confirmBlocked = confirmValue !== undefined && typed !== confirmValue

  return (
    <Dialog
      open={open}
      busy={busy}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent
        data-confirm-dialog=""
        className={cn('max-w-md', className)}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {children}

        {confirmValue !== undefined ? (
          <div className="grid min-w-0 gap-bakin-2" data-confirm-typed="">
            <Label htmlFor={inputId} className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
              {confirmPrompt ?? (
                <>
                  Type <code className="font-bakin-typography-family-mono text-bakin-text-primary">{confirmValue}</code> to confirm
                </>
              )}
            </Label>
            <Input
              id={inputId}
              autoFocus
              value={typed}
              placeholder={confirmValue}
              disabled={busy}
              aria-invalid={typed.length > 0 && confirmBlocked ? true : undefined}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || confirmBlocked || busy) return
                event.preventDefault()
                onConfirm()
              }}
            />
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            data-slot="confirm-dialog-error"
            className="rounded-bakin-control border border-bakin-signal-danger/60 bg-bakin-signal-danger/10 px-bakin-3 py-bakin-2 text-bakin-text-primary"
          >
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant={cancelVariant} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmButtonVariant(confirmTone, confirmVariant)}
            onClick={onConfirm}
            disabled={busy || confirmBlocked}
            data-testid={confirmTestId}
          >
            {busy ? <BusySignal /> : null}
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
