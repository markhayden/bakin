/**
 * Auto-titling — after a chat's FIRST completed exchange, one budget-gated
 * ephemeral LLM call upgrades the fallback title (the truncated first user
 * message) to a real one.
 *
 * Rules:
 * - Only when titleSource is still 'fallback' and this was the first
 *   exchange (messageCount === 2) — later turns never re-title, and a
 *   user rename is never overwritten (setTitle precedence backs this up).
 * - Gated by the ONE spend engine's primitives (dispatchPaused +
 *   budgetGate — the same gates dispatch uses; never parallel spend
 *   math). Blocked = silent skip; the fallback title is already honest.
 * - The call is `ephemeral: true` on its own thread (`chat:<id>:title`) so
 *   it never pollutes the chat's runtime session or transcript.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import { getChatSummary, readTranscript, setTitle } from './store'

const log = createLogger('chat-title')

const TITLE_PROMPT_CONTEXT_MAX = 600
const TITLE_MAX_WORDS = 8

type TitleContext = Pick<PluginContext, 'runtime' | 'events'>

/** Strip quotes/backticks/trailing punctuation; reject junk. */
export function cleanTitle(raw: string | undefined): string | null {
  if (!raw) return null
  const firstLine = raw.trim().split('\n')[0] ?? ''
  const unquoted = firstLine.replace(/^["'`“”]+|["'`“”.。!?]+$/g, '').trim()
  if (!unquoted) return null
  if (unquoted.split(/\s+/).length > TITLE_MAX_WORDS * 2) return null
  return unquoted
}

export async function maybeAutoTitle(ctx: TitleContext, chatId: string): Promise<void> {
  const chat = getChatSummary(chatId)
  if (!chat || chat.titleSource !== 'fallback' || chat.messageCount !== 2) return

  try {
    // Same gate order as dispatch: kill switch → budget. Lazy import keeps
    // the chat plugin's module graph light at activation.
    const { dispatchPaused, budgetGate } = await import('../../../src/core/dispatch-turns')
    const contentDir = getContentDir()
    if (dispatchPaused(contentDir)) return
    const decision = await budgetGate(chat.agentId, contentDir)
    if (decision.action === 'defer') {
      log.info(`auto-title skipped for ${chatId}: budget gate deferred`)
      return
    }

    const rows = readTranscript(chatId)
    const user = rows.find((r) => r.kind === 'user')
    const assistant = rows.find((r) => r.kind === 'assistant')
    if (user?.kind !== 'user' || assistant?.kind !== 'assistant') return

    const result = await ctx.runtime.messaging.send({
      agentId: chat.agentId,
      activityClass: 'system',
      ephemeral: true,
      threadId: `chat:${chatId}:title`,
      content: [
        'Reply with ONLY a short title (3-6 words) for this conversation.',
        'No quotes, no trailing punctuation, no explanation.',
        '',
        `User: ${user.content.slice(0, TITLE_PROMPT_CONTEXT_MAX)}`,
        `Assistant: ${assistant.content.slice(0, TITLE_PROMPT_CONTEXT_MAX)}`,
      ].join('\n'),
    })

    const title = cleanTitle(result.content)
    if (!title) {
      log.warn(`auto-title got an unusable reply for ${chatId} — keeping the fallback`)
      return
    }
    const updated = await setTitle(chatId, title, 'llm')
    if (updated?.title === title) {
      ctx.events.emit('chat.titled', { chatId, title })
    }
  } catch (err) {
    // Titling is a nicety — never let it surface as a chat failure.
    log.warn(`auto-title failed for ${chatId}`, { error: err instanceof Error ? err.message : String(err) })
  }
}
