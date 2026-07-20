'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'
import { ConfirmDialog } from './confirm-dialog'

export type DangerZoneHeadingLevel = 2 | 3 | 4

export interface DangerZoneProps {
  title?: React.ReactNode
  description: React.ReactNode
  confirmLabel: string
  confirmValue: string
  confirmTitle?: React.ReactNode
  confirmDescription?: React.ReactNode
  headingLevel?: DangerZoneHeadingLevel
  busy?: boolean
  error?: React.ReactNode
  onConfirm: () => void
  className?: string
}

/** Consequence-first destructive section with an exact typed confirmation path. */
export function DangerZone({
  title = 'Danger zone',
  description,
  confirmLabel,
  confirmValue,
  confirmTitle,
  confirmDescription,
  headingLevel = 3,
  busy = false,
  error,
  onConfirm,
  className,
}: DangerZoneProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const headingId = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  return (
    <section
      aria-labelledby={headingId}
      data-danger-zone=""
      data-slot="danger-zone"
      className={cn(
        'grid min-w-0 gap-bakin-3 rounded-bakin-surface border border-bakin-signal-danger/60 bg-bakin-signal-danger/10 p-bakin-4 font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-bakin-3">
        <span
          aria-hidden="true"
          data-slot="danger-zone-signal"
          className="flex size-bakin-6 shrink-0 items-center justify-center rounded-bakin-pill border border-bakin-signal-danger font-bakin-typography-weight-bold"
        >
          !
        </span>
        <div className="min-w-0">
          <Heading id={headingId} className="m-0 text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold">
            {title}
          </Heading>
          <div className="mt-bakin-1 max-w-prose [overflow-wrap:anywhere] leading-relaxed text-bakin-text-muted">
            {description}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 justify-start sm:justify-end">
        <Button ref={triggerRef} variant="danger" onClick={() => setOpen(true)} data-danger-zone-trigger="">
          {confirmLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        title={confirmTitle ?? `${confirmLabel}?`}
        description={confirmDescription ?? description}
        confirmLabel={confirmLabel}
        confirmTone="danger"
        confirmValue={confirmValue}
        busy={busy}
        error={error}
        confirmTestId="danger-zone-confirm"
        finalFocus={triggerRef}
        onConfirm={onConfirm}
        onCancel={() => {
          if (!busy) setOpen(false)
        }}
      />
    </section>
  )
}
