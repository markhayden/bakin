/**
 * Chat stream bridge — one agent turn per chat, streamed to the browser.
 *
 * Flow: append the user row → run runtime.messaging.stream() with
 * threadId `chat:<chatId>` → per chunk: emit `chat.chunk` on the event bus
 * (→ global SSE bus → useSSE in the browser) and persist settled rows
 * incrementally through the kit's turn recorder (structured tool rows,
 * interleaving preserved, previews clipped honestly). `chat.done` /
 * `chat.error` close the turn — done carries agentId + a reply preview for
 * the attention system. One in-flight turn per chat; the send route
 * returns 202 and the browser follows along over SSE.
 *
 * Abort: every turn registers an AbortController; abortChatTurn() cancels the
 * runtime stream (a deliberate abort ends with a clean `done` per the
 * runtime contract) and the bridge persists an `aborted` marker row.
 */
import { randomUUID } from 'crypto'

import type { PluginContext } from '@bakin/core/plugin-types'
import type { MessageUsage } from '@bakin/core/adapters/runtime'
import { cleanupPreparedAttachment, prepareImageAttachment, type PreparedAttachment } from '@bakin/core/media/downscale'
import { createTurnRecorder } from '@makinbakin/sdk/utils'

import { createLogger } from '../../../src/core/logger'

/** The bridge needs only messaging + the event bus — accept any context that has them. */
type ChatTurnContext = Pick<PluginContext, 'runtime' | 'events'>
import type { ChatAttachment, ChatTranscriptRow } from '../types'
import { maybeAutoTitle } from './auto-title'
import { appendTranscriptRow, getChatSummary } from './store'

const log = createLogger('chat-stream')

const PREVIEW_MAX = 140

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

/** Carries an error chunk's typed RuntimeError kind through the throw. */
class StreamTurnError extends Error {
  constructor(message: string, readonly kind?: string) {
    super(message)
  }
}

interface InflightTurn {
  promise: Promise<unknown>
  controller: AbortController
  agentId: string
  startedAt: number
  turnId: string
}

// One in-flight turn per chat. The promise is retained so tests (and any
// server-side caller) can await settlement; route handlers never block on it.
const inflight = new Map<string, InflightTurn>()

export function isTurnInFlight(chatId: string): boolean {
  return inflight.has(chatId)
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
  for (const [chatId, turn] of inflight) {
    if (turn.agentId !== agentId) continue
    if (found) return null // ambiguous — never guess
    found = { chatId, turnId: turn.turnId }
  }
  return found
}

/** Await the current turn for a chat (resolved immediately if idle). */
export async function waitForTurn(chatId: string): Promise<void> {
  await (inflight.get(chatId)?.promise ?? Promise.resolve())
}

/** Abort the in-flight turn; returns false when the chat is idle. */
export function abortChatTurn(chatId: string): boolean {
  const turn = inflight.get(chatId)
  if (!turn) return false
  turn.controller.abort()
  return true
}

export type StartTurnResult = 'accepted' | 'not_found' | 'busy'

export async function startChatTurn(
  ctx: ChatTurnContext,
  chatId: string,
  content: string,
  attachments?: ChatAttachment[],
): Promise<StartTurnResult> {
  const chat = getChatSummary(chatId)
  if (!chat) return 'not_found'
  if (inflight.has(chatId)) return 'busy'

  // Reserve the slot SYNCHRONOUSLY — checking then awaiting before setting
  // let two concurrent sends both pass the busy guard (review TOCTOU).
  const controller = new AbortController()
  const turnId = randomUUID()
  const entry: InflightTurn = {
    promise: Promise.resolve(),
    controller,
    agentId: chat.agentId,
    startedAt: Date.now(),
    turnId,
  }
  inflight.set(chatId, entry)

  // Attachment-only sends carry a visible placeholder — the transcript
  // shows exactly what the runtime was asked.
  if (!content.trim() && attachments?.length) content = 'See the attached image.'

  try {
    await appendTranscriptRow(chatId, {
      kind: 'user',
      ts: new Date().toISOString(),
      content,
      ...(attachments?.length ? { attachments } : {}),
    })
  } catch (err) {
    inflight.delete(chatId)
    log.error(`user row append failed for chat ${chatId}`, err as Error)
    return 'not_found'
  }

  // The busy slot releases when the TURN settles; auto-titling chains
  // after release (review finding: awaiting it inside the turn held the
  // slot through a whole LLM round-trip and 409'd quick follow-ups).
  entry.promise = runTurn(ctx, chatId, chat.agentId, content, controller, turnId, attachments)
    .finally(() => {
      inflight.delete(chatId)
    })
    .then((outcome) => (outcome.aborted || outcome.errored ? undefined : maybeAutoTitle(ctx, chatId)))
  return 'accepted'
}

/**
 * Attribute one chat turn's spend under work class 'chat' (metered-only —
 * interactive chat is never routed). Never throws into the turn path.
 */
async function meterChatTurn(chatId: string, agentId: string, turnId: string, usage: MessageUsage | undefined): Promise<void> {
  try {
    const { meterAgentTurn } = await import('../../../src/core/agent-cost')
    await meterAgentTurn({
      runId: `chat:${chatId}:turn:${turnId}`,
      agent: agentId,
      activityClass: 'user',
      workClass: 'chat',
      result: { id: turnId, content: '', ...(usage ? { usage } : {}) },
    })
  } catch (err) {
    log.error(`chat turn metering failed for ${chatId}`, err as Error)
  }
}

async function runTurn(
  ctx: ChatTurnContext,
  chatId: string,
  agentId: string,
  content: string,
  controller: AbortController,
  turnId: string,
  attachments?: ChatAttachment[],
): Promise<{ aborted: boolean; errored: boolean }> {
  const recorder = createTurnRecorder({ turnId })
  let assistantText = ''
  let doneUsage: MessageUsage | undefined
  // Oversized images downscale to temp JPEGs (the shared 2 MB inline-cap
  // shim); prepared temp files are cleaned after the turn settles.
  const prepared: PreparedAttachment[] = []

  const persist = async (rows: ChatTranscriptRow[]) => {
    for (const row of rows) {
      try {
        await appendTranscriptRow(chatId, row)
      } catch (err) {
        // Chat deleted mid-turn: nothing durable left to write — the SSE
        // stream already carried the content to any open UI.
        log.error(`transcript append failed for chat ${chatId}`, err as Error)
      }
    }
  }

  try {
    if (attachments?.length) {
      for (const a of attachments) {
        prepared.push(await prepareImageAttachment(a.path, a.mimeType))
      }
    }
    for await (const chunk of ctx.runtime.messaging.stream({
      agentId,
      content: `${content}\n\n${CHAT_TURN_FRAMING}`,
      threadId: `chat:${chatId}`,
      signal: controller.signal,
      ...(prepared.length
        ? { attachments: prepared.map((a) => ({ path: a.path, mimeType: a.mimeType })) }
        : {}),
    })) {
      // Only liveness chunks ride chat.chunk — done/error have dedicated
      // chat.done/chat.error events, and the wire must match the declared
      // ChatChunkEvent union.
      if (chunk.type === 'text' || chunk.type === 'tool' || chunk.type === 'status') {
        ctx.events.emit('chat.chunk', {
          chatId,
          agentId,
          chunk: {
            type: chunk.type,
            content: chunk.content,
            data: chunk.data,
            ...(chunk.type === 'text' && chunk.format ? { format: chunk.format } : {}),
          },
        })
      }

      if (chunk.type === 'error') {
        const kind = typeof chunk.data?.kind === 'string' ? chunk.data.kind : undefined
        throw new StreamTurnError(chunk.content || 'runtime stream error', kind)
      }

      if (chunk.type === 'text') assistantText += chunk.content
      if (chunk.type === 'done') doneUsage = chunk.usage
      recorder.ingest(chunk)
      // Persist rows as they settle so a crash keeps the partial turn.
      await persist(recorder.drain() as ChatTranscriptRow[])
    }

    await persist(recorder.finish() as ChatTranscriptRow[])
    const aborted = controller.signal.aborted
    if (aborted) {
      await persist([{ kind: 'aborted', ts: new Date().toISOString(), turnId }])
    }
    // Attribute the turn's spend (work class 'chat') — aborted turns billed
    // whatever usage arrived. The runtime's stream done carries usage by
    // conformance pin; a usage-less done still records the run (tokens
    // unknown, never a fabricated zero). Lazy import mirrors auto-title.
    await meterChatTurn(chatId, agentId, turnId, doneUsage)
    ctx.events.emit('chat.done', {
      chatId,
      agentId,
      ...(assistantText ? { preview: firstLine(assistantText) } : {}),
      ...(aborted ? { aborted: true } : {}),
    })
    return { aborted, errored: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The typed kind the adapter attached to its error chunk survives to
    // both the durable row and the SSE event (never re-parsed from text).
    const kind = err instanceof StreamTurnError ? err.kind : undefined
    log.error(`chat turn failed for ${chatId}`, err as Error)
    // Keep whatever streamed before the failure, then record the failure
    // honestly as its own row.
    await persist(recorder.finish() as ChatTranscriptRow[])
    await persist([
      { kind: 'error', ts: new Date().toISOString(), turnId, message, ...(kind ? { errorKind: kind } : {}) },
    ])
    ctx.events.emit('chat.error', { chatId, agentId, message, ...(kind ? { kind } : {}) })
    // Failed turns still get a title shot on the next success; skip here.
    return { aborted: false, errored: true }
  } finally {
    for (const p of prepared) cleanupPreparedAttachment(p)
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, PREVIEW_MAX) ?? ''
}
