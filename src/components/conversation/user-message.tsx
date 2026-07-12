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
            {turn.attachments.map((att) => (
              <img
                key={att.url}
                src={att.url}
                alt={att.name}
                loading="lazy"
                className="max-h-32 rounded-md border border-border object-cover"
              />
            ))}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {turn.content}
        </div>
      </div>
    </div>
  )
}
