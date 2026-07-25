/**
 * Chat stream bridge — chat's consumer of the shared conversation turn
 * engine (src/core/conversation-turns.ts, extracted from this module in
 * #703). The wire contract is unchanged and frozen: one agent turn per
 * chat, `chat.chunk`/`chat.done`/`chat.error` on the event bus (→ global
 * SSE bus → useSSE in the browser), durable rows persisted incrementally
 * through the kit's turn recorder, 202 on send with the browser following
 * over SSE, abort → clean done + `aborted` marker row.
 *
 * Chat-specific policy stays here: the delivery framing, metering under
 * work class 'chat', auto-titling after the slot releases, and the
 * ambiguity-is-null active-turn resolution for mid-turn tool binding.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import {
  createConversationTurnService,
  type StartTurnResult,
  type TurnContext,
} from '../../../src/core/conversation-turns'
import { createChatMeterHook } from '../../../src/core/conversation-metering'

/** The bridge needs only messaging + the event bus — accept any context that has them. */
type ChatTurnContext = Pick<PluginContext, 'runtime' | 'events'>
import type { ChatAttachment, ChatTranscriptRow } from '../types'
import { maybeAutoTitle } from './auto-title'
import { appendTranscriptRow, getChatSummary } from './store'

/**
 * Per-turn delivery framing — the chat counterpart of dispatch's OUTPUT
 * DISCIPLINE. Sent to the runtime with every chat turn (the persisted
 * transcript keeps the user's clean text); short by design. Without it,
 * agents follow their runtime-native skills into the void and reply
 * "here you go" with nothing delivered (the pickle/pumpkin incidents).
 */
export const CHAT_TURN_FRAMING =
  '[Bakin chat turn: you are replying inside an interactive Bakin chat. ' +
  'Deliverables must land IN this chat. Images: call bakin_exec_images_generate ' +
  '(omit taskId — it auto-binds to this chat), then embed the result as ' +
  '![desc](/api/assets/<assetId>) in your reply. Files: bakin_exec_assets_save, then embed. ' +
  'Never claim delivery without the embedded asset. See the bakin skill for details.]'

const service = createConversationTurnService({
  name: 'chat',
  events: { chunk: 'chat.chunk', done: 'chat.done', error: 'chat.error', started: 'chat.started' },
  payload: (chatId) => ({ chatId }),
  resolveThread: (chatId) => {
    const chat = getChatSummary(chatId)
    return chat ? { agentId: chat.agentId } : null
  },
  appendRow: (chatId, row) => appendTranscriptRow(chatId, row as ChatTranscriptRow),
  threadId: (chatId) => `chat:${chatId}`,
  framing: CHAT_TURN_FRAMING,
  hooks: {
    // Spend attribution under work class 'chat' — the shared host meter
    // hook; chat keeps its historical runId scheme.
    meter: createChatMeterHook((chatId, turnId) => `chat:${chatId}:turn:${turnId}`),
    // Failed/aborted turns still get a title shot on the next success; the
    // slot has already released when this runs (quick follow-ups never 409
    // on titling).
    onSettled: ({ ctx, key, outcome }) =>
      outcome.aborted || outcome.errored ? undefined : maybeAutoTitle(ctx as ChatTurnContext, key),
  },
})

export function isTurnInFlight(chatId: string): boolean {
  return service.isInFlight(chatId)
}

/** Assistant text streamed so far for the in-flight turn (null when idle). */
export function inflightTurnPreview(chatId: string): string | null {
  return service.inflightPreview(chatId)
}

/**
 * The chat an agent is CURRENTLY replying in, if any — resolved through the
 * `chat.resolveActiveTurn` hook so tools called mid-turn (image generation)
 * can bind their output to the right chat without the agent knowing ids.
 * AMBIGUITY IS NULL: the same agent streaming in several chats at once
 * cannot be attributed safely (review finding: most-recent picked the
 * wrong chat), so callers fail honestly instead. Includes the turnId so
 * billed-call idempotency scopes to THIS turn, not the chat's lifetime.
 */
export function resolveActiveTurnForAgent(agentId: string): { chatId: string; turnId: string } | null {
  let found: { chatId: string; turnId: string } | null = null
  for (const turn of service.listInFlight()) {
    if (turn.agentId !== agentId) continue
    if (found) return null // ambiguous — never guess
    found = { chatId: turn.key, turnId: turn.turnId }
  }
  return found
}

/** Await the current turn for a chat (resolved immediately if idle). */
export async function waitForTurn(chatId: string): Promise<void> {
  await service.waitFor(chatId)
}

/** Abort the in-flight turn; returns false when the chat is idle. */
export function abortChatTurn(chatId: string): boolean {
  return service.abort(chatId)
}

export async function startChatTurn(
  ctx: ChatTurnContext,
  chatId: string,
  content: string,
  attachments?: ChatAttachment[],
): Promise<StartTurnResult> {
  return service.start(ctx as TurnContext, chatId, content, attachments?.length ? { attachments } : undefined)
}
