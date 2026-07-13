'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  /**
   * Confirm button variant (default "destructive"). Non-destructive
   * confirm flows (repair, switch-with-preview) pass "default" so a
   * healing action doesn't render as a red warning.
   */
  confirmVariant?: 'destructive' | 'default'
  /** Disables both buttons and shows a spinner on confirm while the action is in flight. */
  busy?: boolean
  /** Inline error shown above the footer. */
  error?: string | null
  /** Test id forwarded to the confirm button. */
  confirmTestId?: string
  /** DialogContent className override (default width is `sm:max-w-sm`). */
  className?: string
  /**
   * Typed confirmation: when set, an input is rendered and the confirm button
   * stays disabled until the user types this exact value. For the truly
   * destructive actions where one click is too easy.
   */
  confirmValue?: string
  /** Label above the typed-confirmation input (default: `Type "<confirmValue>" to confirm`). */
  confirmPrompt?: ReactNode
  /**
   * Optional body content between the description and the typed-confirmation
   * input — for the options an action needs decided at confirm time
   * (checkboxes, a preview trigger). Keeps action configuration IN the
   * dialog instead of inline on the page.
   */
  children?: ReactNode
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
  confirmVariant = 'destructive',
  busy = false,
  error,
  confirmTestId,
  className,
  confirmValue,
  confirmPrompt,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  // A reopened dialog must never remember the previous confirmation text.
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  const confirmBlocked = confirmValue !== undefined && typed !== confirmValue

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
        {children}
        {confirmValue !== undefined && (
          <div className="space-y-1.5" data-confirm-typed>
            <Label htmlFor="confirm-typed-input" className="text-xs text-muted-foreground">
              {confirmPrompt ?? (
                <>
                  Type <span className="font-mono text-foreground">{confirmValue}</span> to confirm
                </>
              )}
            </Label>
            <Input
              id="confirm-typed-input"
              autoFocus
              value={typed}
              placeholder={confirmValue}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !confirmBlocked && !busy) onConfirm()
              }}
            />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant={cancelVariant} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={busy || confirmBlocked} data-testid={confirmTestId}>
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
