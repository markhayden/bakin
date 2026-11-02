/**
 * Conversation row types — the canonical home (#809).
 *
 * These are the rows the turn recorder (`@bakin/core/conversation`) emits and
 * every conversation surface renders. `packages/ui` is dependency-free by
 * design, so `packages/ui/src/conversation/fold.ts` keeps a STRUCTURAL copy
 * (the precedent it already sets for `RuntimeChatChunk`); the private module
 * `packages/sdk/src/conversation/message-contract.ts` fails typecheck if the
 * two drift, and `tests/architecture/type-single-home.test.ts` sanctions
 * exactly that pair of homes.
 */

/** Attachment as displayed in a conversation (URL-addressed, not path). */
export interface DisplayAttachment {
  name: string
  mimeType: string
  url: string
}

/** One persisted conversation row accepted by the shared folding engine. */
export type ConversationMessage =
  | { kind: 'user'; ts: string; content: string; attachments?: DisplayAttachment[] }
  | { kind: 'assistant'; ts: string; turnId?: string; agentId?: string; content: string }
  | {
      kind: 'tool'
      ts: string
      turnId?: string
      agentId?: string
      callId?: string
      toolName: string
      status?: 'running' | 'completed' | 'failed' | string
      summary?: string
      inputPreview?: string
      outputPreview?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }
  | { kind: 'error'; ts: string; turnId?: string; message: string; errorKind?: string }
  | { kind: 'aborted'; ts: string; turnId?: string }
  | { kind: 'done'; ts: string; turnId?: string }

/**
 * One structured question an agent asks through `bakin_exec_ask_user`
 * (rides `metadata.bakinQuestion` on the tool row). Canonical home; the core
 * zod schema (`@bakin/core/conversation/questions`) and the ui structural
 * copy are pinned to it by the SDK's private message-contract module.
 */
export interface BakinQuestion {
  v: 1
  id: string
  question: string
  options: { label: string; description?: string }[]
  /** Index into `options` of the agent's recommended answer. */
  recommended?: number
  /** Whether "Something else…" free text is offered. */
  allowOther: boolean
}
