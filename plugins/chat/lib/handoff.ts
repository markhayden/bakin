/**
 * Chat's side of a hand-off: when a turn creates something that owns a
 * conversation (a kind some plugin accepts hand-offs for), the chat's
 * history up to that turn is carried into it, and the chat keeps a
 * "continued in" marker.
 *
 * Chat names no target plugin: targets are whatever the settled turn's
 * tools reported as created, filtered to kinds with a registered acceptor.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { getHandoffRegistry, handoffId, type HandoffRegistry } from '@bakin/core/conversation/handoff'
import type { ConversationTurnRow, HandoffPeer, HandoffRow, TurnOutcome } from '@bakin/core/conversation/turns'
import { createLogger } from '../../../src/core/logger'
import type { ChatTranscriptRow } from '../types'
import { getChatSummary, readTranscript } from './store'

const log = createLogger('chat-handoff')

/** The event open chat tabs follow to redirect (`created === 1` and one target). */
export interface ChatHandoffEvent {
  chatId: string
  turnId: string
  /** How many hand-off targets the reply created. */
  created: number
  /** The targets that accepted the history. */
  targets: HandoffPeer[]
}

interface HandoffDeps {
  registry?: HandoffRegistry
  /** Append the `out` marker without interleaving a live turn's rows. */
  appendOut: (row: HandoffRow) => Promise<unknown>
}

type HandoffContext = Pick<PluginContext, 'events'> & Partial<Pick<PluginContext, 'activity'>>

/**
 * The chat's history as the target receives it: every row up to and
 * including the settled turn's last row (a later, queued turn is not part of
 * it), without bookkeeping rows. Attachments stay in the chat — their files
 * are chat-owned — so a user message keeps a note naming them instead.
 */
export function carriedRows(rows: readonly ChatTranscriptRow[], turnId: string): ConversationTurnRow[] {
  let end = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if ('turnId' in row && row.turnId === turnId) { end = i; break }
  }
  return rows.slice(0, end + 1).flatMap((row): ConversationTurnRow[] => {
    if (row.kind === 'done' || row.kind === 'handoff') return []
    if (row.kind !== 'user' || !row.attachments?.length) return [row as ConversationTurnRow]
    const names = row.attachments.map((attachment) => attachment.name).join(', ')
    const note = `_${row.attachments.length === 1 ? 'Attachment' : 'Attachments'} kept in the original chat: ${names}._`
    return [{ kind: 'user', ts: row.ts, content: row.content ? `${row.content}\n\n${note}` : note }]
  })
}

/**
 * Hand a settled turn's chat over to what it created. Runs for clean,
 * failed and stopped turns alike: whatever was created exists. A target that
 * rejects is logged and audited and gets no marker; the cards in the reply
 * still link to it.
 */
export async function handOffSettledTurn(
  ctx: HandoffContext,
  chatId: string,
  outcome: Pick<TurnOutcome, 'turnId' | 'entities'>,
  { registry = getHandoffRegistry(), appendOut }: HandoffDeps,
): Promise<ChatHandoffEvent | null> {
  const seen = new Set<string>()
  const created = outcome.entities.filter((ref) => {
    if (ref.action !== 'created' || !registry.has(ref.kind)) return false
    const identity = `${ref.kind}\u0000${ref.id}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
  if (created.length === 0) return null

  const chat = getChatSummary(chatId)
  if (!chat) return null
  const source: HandoffPeer = { entity: 'chat:chat', id: chatId, title: chat.title || 'Chat' }
  const carried = carriedRows(readTranscript(chatId), outcome.turnId)

  const targets: HandoffPeer[] = []
  for (const ref of created) {
    try {
      await registry.deliver({
        handoffId: handoffId(chatId, outcome.turnId, ref.id),
        target: { kind: ref.kind, id: ref.id },
        source,
        carried,
      })
      targets.push({ entity: ref.kind, id: ref.id, title: ref.title })
    } catch (err) {
      log.error(`hand-off from chat ${chatId} to ${ref.kind} ${ref.id} failed`, err as Error)
      try {
        ctx.activity?.audit('chat.handoff.failed', 'system', {
          chatId, turnId: outcome.turnId, kind: ref.kind, id: ref.id, error: err instanceof Error ? err.message : String(err),
        })
      } catch (auditErr) {
        log.error('hand-off failure audit failed', auditErr as Error)
      }
    }
  }

  if (targets.length > 0) {
    try {
      await appendOut({
        kind: 'handoff',
        ts: new Date().toISOString(),
        handoffId: `${chatId}:${outcome.turnId}`,
        direction: 'out',
        peers: targets,
      })
    } catch (err) {
      log.error(`hand-off marker append failed for chat ${chatId}`, err as Error)
    }
  }

  const event: ChatHandoffEvent = { chatId, turnId: outcome.turnId, created: created.length, targets }
  try {
    ctx.events.emit('chat.handoff', event as unknown as Record<string, unknown>)
  } catch (err) {
    log.error(`chat.handoff emit failed for chat ${chatId}`, err as Error)
  }
  return event
}
