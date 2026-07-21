'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-2">
      <path d="m3.5 8 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.25" />
      <path d="M3.5 10.5h-.25A1.75 1.75 0 0 1 1.5 8.75v-5.5A1.75 1.75 0 0 1 3.25 1.5h5.5a1.75 1.75 0 0 1 1.75 1.75v.25" />
    </svg>
  )
}

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

/** Props for the shared conversation copy action. */
export interface CopyButtonProps {
  text: string
  label?: string
  className?: string
}

/** Native copy action with a short, non-blocking success acknowledgement. */
export function CopyButton({ text, label = 'Copy', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const copy = useCallback(async () => {
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission failures leave the action available for retry.
    }
  }, [text])

  return (
    <Button
      type="button"
      data-conv-copy=""
      data-copied={copied || undefined}
      variant="ghost"
      size="icon-xs"
      onClick={copy}
      aria-label={copied ? `${label} complete` : label}
      className={cn('text-bakin-text-muted motion-reduce:transition-none', className)}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}
