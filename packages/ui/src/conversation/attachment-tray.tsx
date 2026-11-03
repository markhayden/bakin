'use client'

import type { ReactNode } from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'
import { RemoveIcon, SpinnerIcon } from './glyphs'

export type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'

/** Presentation state for one consumer-owned attachment upload. */
export interface ComposerAttachmentItem {
  id: string
  name: string
  previewUrl?: string
  status?: ComposerAttachmentStatus
  /** Visible failure copy when status is `error`. */
  errorMessage?: string
}

/** Props for the draft's attachment thumbnails. */
export interface ComposerAttachmentTrayProps {
  items: readonly ComposerAttachmentItem[]
  /** The draft cannot change now: remove is disabled (an `itemAction` is the consumer's to disable). */
  disabled?: boolean
  onRemove: (id: string) => void
  /** One more control under a thumbnail (a copy-path button), for items that offer it; rendered as given. */
  itemAction?: (item: ComposerAttachmentItem) => ReactNode
  className?: string
}

/**
 * The thumbnails of a draft's attachments — uploading, failed or ready, each
 * with a remove button — as `Composer` shows them above its input. Upload,
 * removal and sending stay the consumer's; another composer (a terminal's
 * compose sheet) shows its draft's attachments the same way.
 */
export function ComposerAttachmentTray({ items, disabled, onRemove, itemAction, className }: ComposerAttachmentTrayProps) {
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-bakin-2', className)} data-composer-attachments="">
      {items.map((item) => {
        const status = item.status ?? 'ready'
        const action = itemAction?.(item)
        return (
          <div key={item.id} className="flex min-w-0 flex-col items-center gap-bakin-1">
            <div className="relative min-w-0">
              {status === 'uploading' ? (
                <div
                  role="status"
                  aria-label={`Uploading ${item.name}`}
                  className="flex size-20 items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default text-bakin-text-muted"
                >
                  <SpinnerIcon size="md" />
                  <span className="sr-only">Uploading {item.name}</span>
                </div>
              ) : status === 'error' ? (
                <div
                  role="alert"
                  className="flex size-20 flex-col items-center justify-center gap-bakin-1 rounded-bakin-surface border border-bakin-signal-danger bg-bakin-signal-danger/10 p-bakin-2 text-center text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary"
                >
                  <span className="line-clamp-2 font-bakin-typography-weight-semibold">{item.name}</span>
                  <span className="line-clamp-2 text-bakin-signal-danger">{item.errorMessage ?? 'Upload failed'}</span>
                </div>
              ) : item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  className="size-20 rounded-bakin-surface border border-bakin-border-subtle object-cover"
                />
              ) : (
                <div className="flex size-20 items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-2 text-center text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
                  <span className="line-clamp-3 break-all">{item.name}</span>
                </div>
              )}
              <Button
                type="button"
                data-composer-attach-remove=""
                variant="secondary"
                size="icon-xs"
                disabled={disabled}
                aria-label={`Remove ${item.name}`}
                onClick={() => onRemove(item.id)}
                className="absolute -right-bakin-1 -top-bakin-1 rounded-bakin-pill shadow-md"
              >
                <RemoveIcon />
              </Button>
            </div>
            {action}
          </div>
        )
      })}
    </div>
  )
}
