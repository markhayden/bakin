'use client'

/**
 * QueuedMessageList (#729/#732) — follow-ups accepted while a turn streams,
 * rendered as user-style bubbles with a "Queued" badge between the
 * conversation and the composer (never via foldConversation: queued items
 * belong BELOW the live turn, and the fold's turn model stays untouched).
 * Remove hands the WHOLE item back so the surface can restore its text
 * into an empty composer (spec D8).
 */
import { X } from 'lucide-react'

export interface ConversationQueuedItem {
  id: string
  ts: string
  content: string
  attachments?: Array<{ name: string; mimeType: string; url?: string }>
}

export function QueuedMessageList({
  items,
  onRemove,
}: {
  items: ConversationQueuedItem[]
  onRemove?: (item: ConversationQueuedItem) => void
}) {
  if (!items.length) return null
  return (
    <div data-queued-list className="shrink-0 space-y-1.5 px-4 pb-1">
      {items.map((item) => (
        <div key={item.id} data-queued-item={item.id} className="flex justify-end">
          <div className="relative max-w-[75%] rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-2">
            {item.attachments?.length ? (
              <div className="flex flex-wrap gap-1.5 pb-1.5">
                {item.attachments.map((a) =>
                  a.url ? (
                    <img key={a.name} src={a.url} alt={a.name} className="h-12 w-12 rounded-md border border-border object-cover" />
                  ) : (
                    <span key={a.name} className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {a.name}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <div className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.content}</div>
            <div className="pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Queued</div>
            {onRemove ? (
              <button
                type="button"
                data-queued-remove
                aria-label="Remove queued message"
                title="Remove — an empty composer gets the text back for editing"
                onClick={() => onRemove(item)}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-1 text-foreground shadow-sm transition-colors hover:bg-foreground/10"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
