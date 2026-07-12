/**
 * createTurnRecorder — server-side helper turning one streamed turn's
 * RuntimeChatChunks into persisted ConversationMessage rows. ONE
 * implementation of "what survives a turn" shared by the chat plugin's
 * stream bridge and embedded surfaces' plugin routes:
 *
 * - assistant text accumulates and lands as ONE assistant row (in stream
 *   position relative to the tool rows around it — earlier text flushes
 *   when a tool result arrives so replay preserves interleaving)
 * - only `phase:'result'` tool chunks persist, merged over their call
 *   phase (summary/previews), previews clipped at honest byte caps with
 *   a `metadata.truncated` marker
 * - error chunks persist as error rows (after any partial text)
 * - status/done chunks never persist
 */
import type { ChatChunk as RuntimeChatChunk, RuntimeToolActivity } from '@bakin/core/adapters/runtime'
import type { ConversationMessage } from './fold'

export const SUMMARY_MAX_CHARS = 500
export const PREVIEW_MAX_CHARS = 2000

interface RecorderOptions {
  turnId: string
  agentId?: string
  now?: () => string
}

export interface TurnRecorder {
  ingest: (chunk: RuntimeChatChunk) => void
  /** Rows persisted so far plus the trailing text row; call once at turn end. */
  finish: () => ConversationMessage[]
}

function clip(value: string, max: number): { value: string; clipped: boolean } {
  if (value.length <= max) return { value, clipped: false }
  return { value: `${value.slice(0, Math.max(0, max - 1))}…`, clipped: true }
}

export function createTurnRecorder({ turnId, agentId, now }: RecorderOptions): TurnRecorder {
  const stamp = now ?? (() => new Date().toISOString())
  const rows: ConversationMessage[] = []
  const callPhase = new Map<string, RuntimeToolActivity>()
  let pendingText = ''

  const base = () => ({
    ts: stamp(),
    turnId,
    ...(agentId ? { agentId } : {}),
  })

  const flushText = () => {
    if (!pendingText.trim()) {
      pendingText = ''
      return
    }
    rows.push({ kind: 'assistant', ...base(), content: pendingText })
    pendingText = ''
  }

  const ingest = (chunk: RuntimeChatChunk) => {
    switch (chunk.type) {
      case 'text':
        pendingText += chunk.content
        break
      case 'tool': {
        const data = chunk.data
        if (!data?.toolName) break
        if (data.phase === 'call') {
          if (data.callId) callPhase.set(data.callId, data)
          break
        }
        flushText()
        const call = data.callId ? callPhase.get(data.callId) : undefined
        const summaryRaw = data.summary ?? call?.summary
        const inputRaw = data.inputPreview ?? call?.inputPreview
        const outputRaw = data.outputPreview
        const summary = summaryRaw ? clip(summaryRaw, SUMMARY_MAX_CHARS) : undefined
        const input = inputRaw ? clip(inputRaw, PREVIEW_MAX_CHARS) : undefined
        const output = outputRaw ? clip(outputRaw, PREVIEW_MAX_CHARS) : undefined
        const truncated = Boolean(summary?.clipped || input?.clipped || output?.clipped)
        rows.push({
          kind: 'tool',
          ...base(),
          ...(data.callId ? { callId: data.callId } : {}),
          toolName: data.toolName,
          status: data.status === 'failed' ? 'failed' : 'completed',
          ...(summary ? { summary: summary.value } : {}),
          ...(input ? { inputPreview: input.value } : {}),
          ...(output ? { outputPreview: output.value } : {}),
          ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
          ...(data.metadata || truncated
            ? { metadata: { ...(data.metadata ?? {}), ...(truncated ? { truncated: true } : {}) } }
            : {}),
        })
        break
      }
      case 'error':
        flushText()
        rows.push({
          kind: 'error',
          ...base(),
          message: chunk.content || 'turn failed',
          ...(typeof chunk.data?.kind === 'string' ? { errorKind: chunk.data.kind } : {}),
        })
        break
      case 'status':
      case 'done':
        break
    }
  }

  return {
    ingest,
    finish: () => {
      flushText()
      return rows
    },
  }
}
