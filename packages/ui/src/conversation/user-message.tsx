'use client'

import type { ReactNode } from 'react'

import { cn } from '../utils'
import type { ConversationTurn, DisplayAttachment } from './fold'
import { CopyButton, TurnTimestamp } from './turn-controls'

export type ConversationAttachmentRenderer = (attachment: DisplayAttachment) => ReactNode

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.5]">
      <path d="M3.5 1.5h5L12.5 5v9.5h-9v-13Z" strokeLinejoin="round" />
      <path d="M8.5 1.5V5h4" strokeLinejoin="round" />
    </svg>
  )
}

function DefaultAttachment({ attachment }: { attachment: DisplayAttachment }) {
  if (attachment.mimeType.startsWith('image/')) {
    return (
      <img
        src={attachment.url}
        alt={attachment.name}
        loading="lazy"
        className="max-h-32 max-w-full rounded-bakin-surface border border-bakin-border-subtle object-cover"
      />
    )
  }
  return (
    <a
      href={attachment.url}
      download={attachment.name}
      data-conv-file-chip=""
      className={cn(
        'inline-flex min-h-bakin-8 max-w-full items-center gap-bakin-2 rounded-bakin-control border border-bakin-border-subtle',
        'bg-bakin-surface-default px-bakin-3 py-bakin-2 text-bakin-text-primary underline-offset-4 hover:underline',
        'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
      )}
    >
      <FileIcon />
      <span className="min-w-0 truncate">{attachment.name}</span>
    </a>
  )
}

/** Props for one render-ready user message. */
export interface UserMessageProps {
  turn: Extract<ConversationTurn, { kind: 'user' }>
  renderAttachment?: ConversationAttachmentRenderer
  className?: string
}

/** Right-aligned user message with exact time, copy, and typed attachments. */
export function UserMessage({ turn, renderAttachment, className }: UserMessageProps) {
  return (
    <article
      data-conv-user=""
      aria-label="Your message"
      className={cn(
        'flex min-w-0 justify-end font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)]',
        className,
      )}
    >
      <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-bakin-2">
        {turn.attachments?.length ? (
          <div className="flex max-w-full flex-wrap justify-end gap-bakin-2">
            {turn.attachments.map((attachment) => (
              <div key={`${attachment.url}:${attachment.name}`} className="min-w-0 max-w-full">
                {renderAttachment
                  ? renderAttachment(attachment)
                  : <DefaultAttachment attachment={attachment} />}
              </div>
            ))}
          </div>
        ) : null}

        <div className="max-w-full whitespace-pre-wrap break-words rounded-bakin-surface border border-bakin-signal-accent/30 bg-bakin-signal-accent/10 px-bakin-3 py-bakin-2 text-bakin-text-primary">
          {turn.content}
        </div>

        <footer className="flex items-center justify-end gap-bakin-1">
          <TurnTimestamp ts={turn.ts} />
          {turn.content ? <CopyButton text={turn.content} label="Copy message" /> : null}
        </footer>
      </div>
    </article>
  )
}
