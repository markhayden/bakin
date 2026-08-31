'use client'

import { Button } from '../primitives/button'
import { RemoveIcon } from './glyphs'

/** One accepted follow-up waiting behind the active conversation turn. */
export interface ConversationQueuedItem {
  id: string
  ts: string
  content: string
  attachments?: Array<{ name: string; mimeType: string; url?: string }>
}

export interface QueuedMessageListProps {
  items: readonly ConversationQueuedItem[]
  /** Removing returns the full item so consumers can restore it to a draft. */
  onRemove?: (item: ConversationQueuedItem) => void
}

/**
 * Accepted follow-ups live below the active turn rather than inside the
 * durable transcript. The dashed user-style treatment communicates that
 * they are staged without inventing another status-chip language.
 */
export function QueuedMessageList({ items, onRemove }: QueuedMessageListProps) {
  if (!items.length) return null

  return (
    <div
      data-queued-list=""
      className="grid shrink-0 gap-bakin-2 px-bakin-4 pb-bakin-2"
    >
      {items.map((item) => (
        <div key={item.id} data-queued-item={item.id} className="flex min-w-0 justify-end">
          <div className="relative grid max-w-[75%] min-w-0 gap-bakin-1 rounded-bakin-overlay border border-dashed border-bakin-border-subtle bg-bakin-surface-default/55 px-bakin-3 py-bakin-2">
            {item.attachments?.length ? (
              <div className="flex min-w-0 flex-wrap gap-bakin-2">
                {item.attachments.map((attachment) =>
                  attachment.url && attachment.mimeType.startsWith('image/') ? (
                    <img
                      key={attachment.name}
                      src={attachment.url}
                      alt={attachment.name}
                      className="size-12 rounded-bakin-surface border border-bakin-border-subtle object-cover"
                    />
                  ) : (
                    <span
                      key={attachment.name}
                      className="max-w-full truncate rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default px-bakin-2 py-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
                    >
                      {attachment.name}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <p className="m-0 whitespace-pre-wrap break-words text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
              {item.content}
            </p>
            <span className="font-bakin-typography-weight-semibold text-[length:var(--bakin-typography-size-meta)] uppercase tracking-wide text-bakin-text-muted">
              Queued
            </span>
            {onRemove ? (
              <Button
                type="button"
                data-queued-remove=""
                variant="secondary"
                size="icon-xs"
                aria-label="Remove queued message"
                title="Remove — an empty composer gets the text back for editing"
                onClick={() => onRemove(item)}
                className="absolute -right-bakin-1 -top-bakin-1 rounded-bakin-pill shadow-sm"
              >
                <RemoveIcon />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
