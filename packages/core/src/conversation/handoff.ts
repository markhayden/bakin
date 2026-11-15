/**
 * Chat hand-off — carrying a chat's history into the conversation of
 * something the chat just created (a project, a brainstorm session).
 *
 * Core owns the mechanism and names no plugin: a plugin whose manifest
 * declares a kind with `handoff: true` registers an ACCEPTOR for it
 * (`ctx.conversations.acceptHandoff`), and the source (chat) asks this
 * registry to deliver. The acceptor's contract:
 *
 *   - throw when the target does not exist;
 *   - write `request.rows` as ONE atomic batch (the turn service's
 *     `appendRows`), resolving only once it is durable — including when the
 *     target has a turn in flight;
 *   - accept a `handoffId` once: a repeat is a no-op.
 *
 * `writeHandoffBatch` implements the last two over a turn service.
 */
import type { ConversationTurnRow, ConversationTurnService, HandoffPeer, HandoffRow, TurnContext } from './turns'

export interface HandoffRequest {
  /** `<chatId>:<turnId>:<entityId>` — accept once. */
  handoffId: string
  target: { kind: string; id: string }
  /** The complete batch: the `in` marker, then the carried rows. */
  rows: ConversationTurnRow[]
}

export type HandoffAcceptor = (request: HandoffRequest) => Promise<void> | void

export class HandoffError extends Error {
  constructor(message: string, public readonly kind: 'no_acceptor' | 'rejected', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HandoffError'
  }
}

export interface HandoffDelivery {
  handoffId: string
  target: { kind: string; id: string }
  /** Where the history comes from; rendered as "Carried over from …". */
  source: HandoffPeer
  /** The source's history, oldest first. */
  carried: ConversationTurnRow[]
  ts?: string
}

export interface HandoffRegistry {
  register(pluginId: string, kind: string, acceptor: HandoffAcceptor): void
  /** Remove every acceptor `pluginId` registered. */
  sweep(pluginId: string): void
  has(kind: string): boolean
  /** Resolves once the target holds the history; rejects with a `HandoffError`. */
  deliver(delivery: HandoffDelivery): Promise<void>
}

export function handoffId(chatId: string, turnId: string, entityId: string): string {
  return `${chatId}:${turnId}:${entityId}`
}

export function createHandoffRegistry(): HandoffRegistry {
  const acceptors = new Map<string, { pluginId: string; acceptor: HandoffAcceptor }>()
  return {
    register(pluginId, kind, acceptor) {
      const existing = acceptors.get(kind)
      if (existing) throw new Error(`Hand-off kind "${kind}" already has an acceptor (plugin "${existing.pluginId}")`)
      acceptors.set(kind, { pluginId, acceptor })
    },
    sweep(pluginId) {
      for (const [kind, entry] of acceptors) if (entry.pluginId === pluginId) acceptors.delete(kind)
    },
    has: (kind) => acceptors.has(kind),
    async deliver({ handoffId: id, target, source, carried, ts }) {
      const entry = acceptors.get(target.kind)
      if (!entry) throw new HandoffError(`No plugin accepts a hand-off for "${target.kind}"`, 'no_acceptor')
      const marker: HandoffRow = {
        kind: 'handoff',
        ts: ts ?? new Date().toISOString(),
        handoffId: id,
        direction: 'in',
        peers: [source],
        carried: carried.length,
      }
      try {
        await entry.acceptor({ handoffId: id, target, rows: [marker, ...carried] })
      } catch (err) {
        throw new HandoffError(
          `"${target.kind}" ${target.id} did not accept the hand-off: ${err instanceof Error ? err.message : String(err)}`,
          'rejected',
          { cause: err },
        )
      }
    },
  }
}

const g = globalThis as { __bakinHandoffRegistry?: HandoffRegistry }

/** The process-wide registry (globalThis-backed: survives module re-evaluation). */
export function getHandoffRegistry(): HandoffRegistry {
  return (g.__bakinHandoffRegistry ??= createHandoffRegistry())
}

/** Whether a transcript already holds this hand-off. */
export function hasAcceptedHandoff(rows: readonly ConversationTurnRow[], id: string): boolean {
  return rows.some((row) => row.kind === 'handoff' && row.direction === 'in' && row.handoffId === id)
}

/**
 * The acceptor's write, over a turn service: a repeat is a no-op; otherwise
 * the batch goes through `appendExternal` (one atomic write when the service
 * has `appendRows`) and this resolves only once it is durable, waiting out a
 * turn in flight. The caller checks the target exists first and throws if not.
 */
export async function writeHandoffBatch(
  service: Pick<ConversationTurnService, 'appendExternal'>,
  ctx: TurnContext,
  key: string,
  request: HandoffRequest,
  existing: readonly ConversationTurnRow[],
): Promise<void> {
  if (hasAcceptedHandoff(existing, request.handoffId)) return
  const result = await service.appendExternal(ctx, key, request.rows)
  await result.written
}

/** Default size of the carried-history preamble handed to the receiving agent. */
export const HANDOFF_PREAMBLE_BYTES = 16 * 1024

const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * The carried history as a one-time preamble for the receiving agent's next
 * turn, or `null` when that agent has already replied since the hand-off.
 *
 * Derived, never stored: after the latest `in` marker and its carried rows,
 * an assistant row from `agentId` (or an unattributed one) means the agent
 * has the history in its session. So a turn that failed before reaching the
 * runtime primes again on retry, and a second agent on the same target is
 * primed for its own thread. Byte-budgeted, newest kept, with a visible
 * omission marker; a message is never cut mid-character.
 */
export function handoffPreamble(
  rows: readonly ConversationTurnRow[],
  agentId: string,
  { maxBytes = HANDOFF_PREAMBLE_BYTES }: { maxBytes?: number } = {},
): string | null {
  let at = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.kind === 'handoff' && row.direction === 'in') { at = i; break }
  }
  if (at < 0) return null
  const marker = rows[at] as HandoffRow
  const carriedEnd = at + 1 + (marker.carried ?? 0)
  const replied = rows.slice(carriedEnd).some((row) =>
    row.kind === 'assistant' && (row.agentId === undefined || row.agentId === agentId))
  if (replied) return null

  const lines = rows.slice(at + 1, carriedEnd).flatMap((row) => {
    if (row.kind === 'user') return [`User: ${row.content}`]
    if (row.kind === 'assistant' && row.content.trim()) return [`Assistant: ${row.content}`]
    return []
  })
  if (lines.length === 0) return null

  const source = marker.peers[0]?.title
  const head = [
    'The user began this conversation in a chat and continued it here. The earlier conversation follows.',
    'It is context, not a new request: do not answer or repeat it. Reply to the message that comes after it.',
    '',
    `--- Earlier conversation${source ? ` (carried over from the chat "${source}")` : ''} ---`,
  ].join('\n')
  const tail = '--- End of the earlier conversation ---'
  const omitted = (count: number) => `[… ${count} earlier message${count === 1 ? '' : 's'} omitted …]`

  let budget = maxBytes - bytes(head) - bytes(tail) - 2
  const kept: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    const remainingAfter = i // messages older than this one
    const reserve = remainingAfter > 0 ? bytes(omitted(remainingAfter)) + 1 : 0
    const cost = bytes(line) + 1
    if (cost + reserve <= budget) {
      kept.unshift(line)
      budget -= cost
      continue
    }
    if (kept.length > 0) {
      // This message and everything older is dropped.
      kept.unshift(omitted(i + 1))
      break
    }
    // The newest message alone is over budget: keep what fits, by code point
    // (never mid-character), and drop everything older.
    const note = ' […]'
    let clipped = ''
    for (const char of line) {
      if (bytes(clipped + char) + bytes(note) + 1 + reserve > budget) break
      clipped += char
    }
    if (clipped) kept.unshift(clipped + note)
    if (i > 0) kept.unshift(omitted(i))
    break
  }
  return [head, ...kept, tail].join('\n')
}
