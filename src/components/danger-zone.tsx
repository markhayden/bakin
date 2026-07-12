'use client'

import { useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

export interface DangerZoneProps {
  /** Section heading (default "Danger zone"). */
  title?: ReactNode
  /** What the action destroys and what the consequences are — spell it out. */
  description: ReactNode
  /** The destructive button + dialog confirm label (e.g. "Delete this brand"). */
  confirmLabel: string
  /** The exact value the user must type to arm the confirm button (e.g. the record id). */
  confirmValue: string
  /** Dialog title (default = confirmLabel + "?"). */
  confirmTitle?: ReactNode
  /** Dialog body copy (default = description). */
  confirmDescription?: ReactNode
  /** Action in flight — keeps the dialog open and disables its buttons. */
  busy?: boolean
  /** Inline error from a failed attempt, shown in the dialog. */
  error?: string | null
  onConfirm: () => void
  className?: string
}

/**
 * The big-and-scary destructive section that belongs at the very bottom of a
 * settings surface: red-bordered, consequences spelled out, and a typed
 * confirmation (via ConfirmDialog's `confirmValue` — the ONE confirm engine)
 * so nothing irreversible is one accidental click away.
 */
export function DangerZone({
  title = 'Danger zone',
  description,
  confirmLabel,
  confirmValue,
  confirmTitle,
  confirmDescription,
  busy = false,
  error,
  onConfirm,
  className,
}: DangerZoneProps) {
  const [open, setOpen] = useState(false)

  return (
    <section
      data-danger-zone
      className={cn('rounded-xl border border-destructive/40 bg-destructive/5 p-4', className)}
    >
      <h3 className="flex items-center gap-2 text-sm font-medium text-destructive">
        <TriangleAlert className="size-4" />
        {title}
      </h3>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      <Button
        variant="destructive"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
        data-danger-zone-trigger
      >
        {confirmLabel}
      </Button>
      <ConfirmDialog
        open={open}
        title={confirmTitle ?? `${confirmLabel}?`}
        description={confirmDescription ?? description}
        confirmLabel={confirmLabel}
        confirmValue={confirmValue}
        busy={busy}
        error={error}
        confirmTestId="danger-zone-confirm"
        onConfirm={onConfirm}
        onCancel={() => {
          if (!busy) setOpen(false)
        }}
      />
    </section>
  )
}
