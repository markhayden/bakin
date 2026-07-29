import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../utils'
import type { StatusTone } from './status-badge'

export interface StatusMarkerProps extends ComponentPropsWithoutRef<'span'> {
  tone?: StatusTone
  size?: 'sm' | 'md'
  /** Required when the marker communicates status without nearby visible copy. */
  label?: string
}

const toneClass: Record<StatusTone, string> = {
  neutral: 'bg-bakin-text-muted',
  success: 'bg-bakin-action-primary-background',
  attention: 'bg-bakin-signal-highlight',
  danger: 'bg-bakin-signal-danger',
  accent: 'bg-bakin-signal-accent',
}

/** A compact semantic marker for dense views where adjacent text carries the state. */
export function StatusMarker({
  tone = 'neutral',
  size = 'sm',
  label,
  className,
  ...props
}: StatusMarkerProps) {
  return (
    <span
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      data-status-marker={tone}
      data-tone={tone}
      {...props}
      className={cn(
        'inline-block shrink-0 rounded-bakin-pill',
        size === 'sm' ? 'size-bakin-2' : 'size-bakin-3',
        toneClass[tone],
        className,
      )}
    />
  )
}
