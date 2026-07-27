'use client'

/**
 * UserMessage — the user's side of a conversation: right-aligned bubble in
 * contrast-safe tokens, attachment thumbnails, hover timestamp + copy.
 */
import type { ConversationTurn } from './fold'
import { CopyButton, TurnTimestamp } from './agent-turn'

export interface UserMessageProps {
  turn: Extract<ConversationTurn, { kind: 'user' }>
}

export function UserMessage({ turn }: UserMessageProps) {
  return (
    <div className="group/turn flex items-center justify-end gap-1.5" data-conv-user>
      {/* Hover actions sit INLINE left of the bubble — a below-the-bubble row
          reserved a phantom empty line under every message. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <TurnTimestamp ts={turn.ts} />
        <CopyButton text={turn.content} label="Copy message" />
      </div>
      <div className="flex max-w-[85%] flex-col items-end gap-1.5">
        {turn.attachments?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {turn.attachments.map((att) =>
              att.mimeType.startsWith('image/') ? (
                <img
                  key={att.url}
                  src={att.url}
                  alt={att.name}
                  loading="lazy"
                  className="max-h-32 rounded-md border border-border object-cover"
                />
              ) : (
                // File-lane attachments (PDF, …) — a download chip; the
                // serve route ships these as opaque octet-stream downloads.
                <a
                  key={att.url}
                  href={att.url}
                  download={att.name}
                  data-conv-file-chip
                  className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  {att.name}
                </a>
              ),
            )}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {turn.content}
        </div>
      </div>
    </div>
  )
}
