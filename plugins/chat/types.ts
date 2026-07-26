/**
 * Chat plugin types — Bakin-owned UI data for direct agent conversations.
 *
 * A chat is a durable conversation with one agent, keyed by a Bakin-side
 * chatId. The runtime session (provider-side) is addressed via the
 * adapter-neutral threadId `chat:<chatId>`; the plugin persists the chunks
 * it streamed as its own transcript under ~/.bakin/chat/ (UI data — the
 * runtime session stays the provider-side source of truth).
 *
 * Transcript schema v2: rows are the conversation kit's storable shape
 * (structured tool rows with callId/status/previews, turnId grouping,
 * aborted markers) so replay folds exactly like live streaming. v1 rows
 * (aggregate `"name: summary"` tool strings, no turnId) still parse via a
 * lenient union — no migration, degraded-but-honest replay.
 */

/** How the chat's title was set; user renames are never overwritten. */
export type ChatTitleSource = 'fallback' | 'llm' | 'user'

/** Chat index entry (one per chat, stored in index.json). */
export interface ChatSummary {
  id: string
  agentId: string
  title: string
  titleSource: ChatTitleSource
  pinned: boolean
  createdAt: string
  updatedAt: string
  /** Count of user+assistant messages for list display. */
  messageCount: number
  /** Agent replies since the user last viewed the chat (reset by markSeen). */
  unreadCount: number
  /** When the user last viewed this chat. */
  lastSeenAt?: string
  lastMessageAt?: string
  /** First line of the newest message, for list rows + notifications. */
  lastMessagePreview?: string
  /**
   * True for chats created since #735: every settled turn ends on a
   * terminal row (done | aborted | error), so the boot sweep may stamp a
   * non-terminal tail turn as interrupted. Pre-#735 chats parse as false
   * (zod default) until their transcript shows a done row.
   */
  markerEra: boolean
  /**
   * Binds this chat to an external channel (#669 Phase B) — e.g.
   * "discord:channel:<id>". Inbound messages route here; replies post back.
   */
  externalKey?: string
}

/** A user-sent attachment as persisted (path-addressed; served by GET route). */
export interface ChatAttachment {
  name: string
  mimeType: string
  path: string
}

/** A persisted transcript row (one JSONL line in <chatId>.jsonl). */
/** A follow-up accepted while a turn streamed (#729) — mirrors the engine's QueuedMessage. */
export interface ChatQueuedMessage {
  id: string
  ts: string
  content: string
  agentId: string
  attachments?: ChatAttachment[]
}

export type ChatTranscriptRow =
  | { kind: 'user'; ts: string; content: string; attachments?: ChatAttachment[] }
  | { kind: 'assistant'; ts: string; turnId?: string; content: string }
  | {
      kind: 'tool'
      ts: string
      turnId?: string
      callId?: string
      toolName: string
      status: 'completed' | 'failed'
      summary?: string
      inputPreview?: string
      outputPreview?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }
  | { kind: 'error'; ts: string; turnId?: string; message: string; errorKind?: string }
  | { kind: 'aborted'; ts: string; turnId?: string }
  | { kind: 'done'; ts: string; turnId?: string }

/** SSE payloads broadcast on the global bus while a turn streams. */
export interface ChatChunkEvent {
  type: 'chat.chunk'
  chatId: string
  agentId: string
  chunk: {
    type: 'text' | 'tool' | 'status'
    content?: string
    /** Text chunks: render format hint; absent = markdown. */
    format?: 'markdown' | 'plain' | 'code'
    data?: Record<string, unknown>
  }
}

export interface ChatDoneEvent {
  type: 'chat.done'
  chatId: string
  agentId: string
  /** First line of the reply, for toasts/notifications. */
  preview?: string
  /** True when the turn ended via user abort (no notification fanfare). */
  aborted?: boolean
}

export interface ChatErrorEvent {
  type: 'chat.error'
  chatId: string
  agentId: string
  message: string
  /** Typed RuntimeError kind when the runtime provided one. */
  kind?: string
}
