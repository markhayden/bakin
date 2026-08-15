'use client'


import { cn } from '../utils'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'

/** Props for a compact, fully described conversation timestamp. */
export interface TurnTimestampProps {
  ts?: string
  className?: string
}

/** Visible relative time with the exact local timestamp as supplemental context. */
export function TurnTimestamp({ ts, className }: TurnTimestampProps) {
  if (!ts) return null
  const relative = formatRelativeTime(ts)
  if (!relative) return null
  return (
    <time
      dateTime={ts}
      title={formatAbsoluteTime(ts)}
      className={cn(
        'shrink-0 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted',
        className,
      )}
    >
      {relative}
    </time>
  )
}

// CopyButton now lives in the shared pattern layer; conversation surfaces
// re-export it so their imports stay local to the kit they compose.
export { CopyButton } from '../patterns/copy-button'
export type { CopyButtonProps } from '../patterns/copy-button'
