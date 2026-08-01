'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../primitives/card'
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
    <Card
      role="region"
      aria-labelledby={headingId}
      data-danger-zone=""
      data-slot="danger-zone"
      className={cn(
        'border-bakin-signal-danger/60 bg-bakin-signal-danger/10',
        className,
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-bakin-2 text-base font-bakin-typography-weight-semibold">
          <span
            aria-hidden="true"
            data-slot="danger-zone-signal"
            className="flex size-bakin-4 shrink-0 items-center justify-center text-bakin-signal-danger"
          >
            <svg viewBox="0 0 16 16" className="size-full fill-none stroke-current stroke-[1.5]">
              <circle cx="8" cy="8" r="6.25" />
              <path strokeLinecap="round" d="M8 4.5v4M8 11.5h.01" />
            </svg>
          </span>
          <Heading id={headingId} className="m-0 text-inherit font-inherit">
            {title}
          </Heading>
        </CardTitle>
        <CardDescription className="mb-bakin-1 mt-bakin-1 max-w-3xl text-sm leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 justify-start">
        <Button
          ref={triggerRef}
          variant="danger"
          size="sm"
          className="border-bakin-signal-danger bg-bakin-signal-danger text-bakin-canvas-default hover:bg-bakin-signal-danger hover:brightness-110"
          onClick={() => setOpen(true)}
          data-danger-zone-trigger=""
        >
          {confirmLabel}
        </Button>
      </CardContent>

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
    </Card>
  )
}
