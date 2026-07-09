/**
 * Chat plugin types — Bakin-owned UI data for direct agent conversations.
 *
 * A chat is a durable conversation with one agent, keyed by a Bakin-side
 * chatId. The runtime session (provider-side) is addressed via the
 * adapter-neutral threadId `chat:<chatId>`; the plugin persists the chunks
 * it streamed as its own transcript under ~/.bakin/chat/ (UI data — the
 * runtime session stays the provider-side source of truth).
 */

/** Chat index entry (one per chat, stored in index.json). */
export interface ChatSummary {
  id: string
  agentId: string
  title: string
  createdAt: string
  updatedAt: string
  /** Count of user+assistant messages for list display. */
  messageCount: number
}

/** A persisted transcript row (one JSONL line in <chatId>.jsonl). */
export type ChatTranscriptRow =
  | { kind: 'user'; ts: string; content: string }
  | { kind: 'assistant'; ts: string; content: string }
  | { kind: 'tool'; ts: string; summary: string }
  | { kind: 'error'; ts: string; message: string }

/** SSE payloads broadcast on the global bus while a turn streams. */
export interface ChatChunkEvent {
  type: 'chat.chunk'
  chatId: string
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
}

export interface ChatErrorEvent {
  type: 'chat.error'
  chatId: string
  message: string
}
