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

/** Carries an error chunk's typed RuntimeError kind through the throw. */
class StreamTurnError extends Error {
  constructor(message: string, readonly kind?: string) {
    super(message)
  }
}

interface InflightTurn {
  promise: Promise<void>
  controller: AbortController
  agentId: string
  startedAt: number
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
 * Ambiguity (same agent streaming in several chats) resolves to the most
 * recently started turn.
 */
export function resolveActiveTurnForAgent(agentId: string): { chatId: string } | null {
  let best: { chatId: string; startedAt: number } | null = null
  for (const [chatId, turn] of inflight) {
    if (turn.agentId !== agentId) continue
    if (!best || turn.startedAt > best.startedAt) best = { chatId, startedAt: turn.startedAt }
  }
  return best ? { chatId: best.chatId } : null
}

/** Await the current turn for a chat (resolved immediately if idle). */
export function waitForTurn(chatId: string): Promise<void> {
  return inflight.get(chatId)?.promise ?? Promise.resolve()
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

  // Attachment-only sends carry a visible placeholder — the transcript
  // shows exactly what the runtime was asked.
  if (!content.trim() && attachments?.length) content = 'See the attached image.'

  await appendTranscriptRow(chatId, {
    kind: 'user',
    ts: new Date().toISOString(),
    content,
    ...(attachments?.length ? { attachments } : {}),
  })

  const controller = new AbortController()
  const promise = runTurn(ctx, chatId, chat.agentId, content, controller, attachments).finally(() => {
    inflight.delete(chatId)
  })
  inflight.set(chatId, { promise, controller, agentId: chat.agentId, startedAt: Date.now() })
  return 'accepted'
}

async function runTurn(
  ctx: ChatTurnContext,
  chatId: string,
  agentId: string,
  content: string,
  controller: AbortController,
  attachments?: ChatAttachment[],
): Promise<void> {
  const turnId = randomUUID()
  const recorder = createTurnRecorder({ turnId })
  let assistantText = ''
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
      content,
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
      recorder.ingest(chunk)
      // Persist rows as they settle so a crash keeps the partial turn.
      await persist(recorder.drain() as ChatTranscriptRow[])
    }

    await persist(recorder.finish() as ChatTranscriptRow[])
    const aborted = controller.signal.aborted
    if (aborted) {
      await persist([{ kind: 'aborted', ts: new Date().toISOString(), turnId }])
    }
    ctx.events.emit('chat.done', {
      chatId,
      agentId,
      ...(assistantText ? { preview: firstLine(assistantText) } : {}),
      ...(aborted ? { aborted: true } : {}),
    })
    // First-exchange auto-titling (budget-gated, ephemeral). Awaited so the
    // turn promise settles deterministically; the UI already got its done.
    if (!aborted) await maybeAutoTitle(ctx, chatId)
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
  } finally {
    for (const p of prepared) cleanupPreparedAttachment(p)
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, PREVIEW_MAX) ?? ''
}
