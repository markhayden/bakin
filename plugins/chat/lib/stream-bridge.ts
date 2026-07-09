/**
 * Chat stream bridge — one agent turn per chat, streamed to the browser.
 *
 * Flow: append the user row → run runtime.messaging.stream() with
 * threadId `chat:<chatId>` → per chunk: persist what's durable (tool
 * results, final assistant text) and emit `chat.chunk` on the event bus
 * (→ global SSE bus → useSSE in the browser). `chat.done` / `chat.error`
 * close the turn. One in-flight turn per chat; the send route returns 202
 * and the browser follows along over SSE.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import { createLogger } from '../../../src/core/logger'

/** The bridge needs only messaging + the event bus — accept any context that has them. */
type ChatTurnContext = Pick<PluginContext, 'runtime' | 'events'>
import type { ChatTranscriptRow } from '../types'
import { appendTranscriptRow, getChatSummary } from './store'

const log = createLogger('chat-stream')

type ToolActivity = { toolName?: string; phase?: string; summary?: string; status?: string; callId?: string }

// One in-flight turn per chat. The promise is retained so tests (and any
// server-side caller) can await settlement; route handlers never block on it.
const inflight = new Map<string, Promise<void>>()

export function isTurnInFlight(chatId: string): boolean {
  return inflight.has(chatId)
}

/** Await the current turn for a chat (resolved immediately if idle). */
export function waitForTurn(chatId: string): Promise<void> {
  return inflight.get(chatId) ?? Promise.resolve()
}

export type StartTurnResult = 'accepted' | 'not_found' | 'busy'

export async function startChatTurn(
  ctx: ChatTurnContext,
  chatId: string,
  content: string,
): Promise<StartTurnResult> {
  const chat = getChatSummary(chatId)
  if (!chat) return 'not_found'
  if (inflight.has(chatId)) return 'busy'

  await appendTranscriptRow(chatId, { kind: 'user', ts: new Date().toISOString(), content })

  const turn = runTurn(ctx, chatId, chat.agentId, content).finally(() => {
    inflight.delete(chatId)
  })
  inflight.set(chatId, turn)
  return 'accepted'
}

async function runTurn(
  ctx: ChatTurnContext,
  chatId: string,
  agentId: string,
  content: string,
): Promise<void> {
  let assistantText = ''
  const callSummaries = new Map<string, string>()
  const persist = async (row: ChatTranscriptRow) => {
    try {
      await appendTranscriptRow(chatId, row)
    } catch (err) {
      // Chat deleted mid-turn: nothing durable left to write — the SSE
      // stream already carried the content to any open UI.
      log.error(`transcript append failed for chat ${chatId}`, err as Error)
    }
  }

  try {
    for await (const chunk of ctx.runtime.messaging.stream({
      agentId,
      content,
      threadId: `chat:${chatId}`,
    })) {
      ctx.events.emit('chat.chunk', { chatId, chunk: { type: chunk.type, content: chunk.content, data: chunk.data } })

      if (chunk.type === 'text' && chunk.content) {
        assistantText += chunk.content
      } else if (chunk.type === 'tool') {
        const tool = (chunk.data ?? {}) as ToolActivity
        // Persist one row per completed tool call; 'call' phases are
        // ephemeral progress the SSE stream already carried. Result chunks
        // usually carry no summary — reuse the call's so durable rows keep
        // their detail instead of degrading to a bare tool name.
        if (tool.phase === 'call' && tool.callId && tool.summary) {
          callSummaries.set(tool.callId, tool.summary)
        }
        if (tool.phase === 'result') {
          const name = tool.toolName ?? 'tool'
          const summary = tool.summary ?? (tool.callId ? callSummaries.get(tool.callId) : undefined)
          await persist({
            kind: 'tool',
            ts: new Date().toISOString(),
            summary: summary ? `${name}: ${summary}` : name,
          })
        }
      } else if (chunk.type === 'error') {
        throw new Error(chunk.content || 'runtime stream error')
      }
    }

    if (assistantText) {
      await persist({ kind: 'assistant', ts: new Date().toISOString(), content: assistantText })
    }
    ctx.events.emit('chat.done', { chatId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`chat turn failed for ${chatId}`, err as Error)
    // Keep whatever streamed before the failure, then record the failure
    // honestly as its own row.
    if (assistantText) {
      await persist({ kind: 'assistant', ts: new Date().toISOString(), content: assistantText })
    }
    await persist({ kind: 'error', ts: new Date().toISOString(), message })
    ctx.events.emit('chat.error', { chatId, message })
  }
}
