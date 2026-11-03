'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { copyToClipboard } from '../behaviors/clipboard'
import { Button } from '../primitives/button'
import { cn } from '../utils'

function CopyIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={cn(className, 'fill-none stroke-current stroke-[1.5]')}>
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.25" />
      <path d="M3.5 10.5h-.25A1.75 1.75 0 0 1 1.5 8.75v-5.5A1.75 1.75 0 0 1 3.25 1.5h5.5a1.75 1.75 0 0 1 1.75 1.75v.25" />
    </svg>
  )
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={cn(className, 'fill-none stroke-current stroke-2')}>
      <path d="m3.5 8 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Props for the shared copy action. */
export interface CopyButtonProps {
  text: string
  /** Action name; the accessible name becomes `<label> complete` on success. */
  label?: string
  className?: string
  /**
   * `default` is the compact 24px action beside inline text; `touch` is a
   * 44px target for a coarse pointer, where the copy action is the point of
   * the surface (a tap-to-copy prompt, an offer to copy).
   */
  size?: 'default' | 'touch'
  /** Runs after the text actually reached the clipboard — never on a refused write. */
  onCopied?: () => void
}

/**
 * Copy action with a short, non-blocking success acknowledgement.
 *
 * The confirmation is carried by the swapped icon AND the accessible name —
 * never by a native tooltip, which would leave the result unannounced.
 * Success only shows when the clipboard write actually happened.
 */
export function CopyButton({ text, label = 'Copy', className, size = 'default', onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The clipboard write is awaited, so the component can unmount mid-copy.
  const mounted = useRef(true)

  useEffect(() => () => {
    mounted.current = false
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const copy = useCallback(async () => {
    if (!await copyToClipboard(text)) return
    onCopied?.()
    if (!mounted.current) return
    setCopied(true)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopied(false), 1500)
  }, [onCopied, text])

  const icon = size === 'touch' ? 'size-bakin-4' : 'size-bakin-3'
  return (
    <Button
      type="button"
      data-slot="copy-button"
      data-copied={copied || undefined}
      data-size={size}
      variant="ghost"
      size={size === 'touch' ? 'icon-lg' : 'icon-xs'}
      onClick={copy}
      aria-label={copied ? `${label} complete` : label}
      className={cn('text-bakin-text-muted motion-reduce:transition-none', className)}
    >
      {copied ? <CheckIcon className={icon} /> : <CopyIcon className={icon} />}
    </Button>
  )
}
