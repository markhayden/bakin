/**
 * Brand-doc brainstorm bridge — brands' consumer of the shared
 * conversation turn engine (#703). Turns run server-side and stream as
 * `brands.brainstorm.chunk/done/error` over the plugin-event bus, so
 * navigating away from the doc editor no longer kills the turn; the
 * transcript is durable per doc (store.ts sidecar).
 *
 * Brand-doc policy preserved from the per-request era: per-TURN ephemeral
 * runtime threads (the prompt carries the full capped doc + history every
 * turn — session reuse would double-pay it), and the agent is chosen per
 * send (panel agent picker) via the engine's agentId override. Brainstorm
 * turns are metered under work class 'chat' (they were unmetered before —
 * a cost-attribution gap #703 closes).
 */
import { randomUUID } from 'crypto'


import { conversationThreadId } from '../../../src/components/conversation/thread-id'
import { createConversationTurnService } from '../../../src/core/conversation-turns'
import { createChatMeterHook } from '../../../src/core/conversation-metering'
import { createLogger } from '../../../src/core/logger'
import { appendDocBrainstormRow, getBrand, listDocBrainstormKeys, readDocBrainstorm, type BrandDocKind } from './store'

const log = createLogger('brands-brainstorm')

/** Composite thread key `<brandId>/<kind>/<name>` (no segment may contain '/'). */
export function docBrainstormKey(brandId: string, kind: BrandDocKind, name: string): string {
  return `${brandId}/${kind}/${name}`
}

function parseKey(key: string): { brandId: string; kind: BrandDocKind; name: string } {
  const [brandId, kind, name] = key.split('/')
  return { brandId, kind: kind as BrandDocKind, name }
}

export const brandBrainstormTurns = createConversationTurnService({
  name: 'brands.brainstorm',
  events: {
    chunk: 'brands.brainstorm.chunk',
    done: 'brands.brainstorm.done',
    error: 'brands.brainstorm.error',
  },
  payload: (key) => ({ key, ...parseKey(key) }),
  resolveThread: (key) => {
    // Brand-existence check only — the doc itself may be unsaved (the
    // editor sends its live content per turn), and the agent arrives per
    // turn via the override (the panel's agent picker), never from the
    // thread.
    const { brandId, kind, name } = parseKey(key)
    if (!brandId || !name || (kind !== 'guidelines' && kind !== 'lessons')) return null
    if (getBrand(brandId).status !== 'ok') return null
    return { agentId: '' }
  },
  appendRow: (key, row) => {
    const { brandId, kind, name } = parseKey(key)
    appendDocBrainstormRow(brandId, kind, name, row)
  },
  // Per-TURN thread: fresh UUID every turn so the runtime session never
  // re-accumulates the doc prompt (that combination was quadratic).
  threadId: (key, agentId) => conversationThreadId('brand-doc', `${key}/${randomUUID()}`, agentId),
  ephemeral: true,
  hooks: {
    meter: createChatMeterHook((key, turnId) => `brainstorm:brands:${key}:turn:${turnId}`),
  },
})

/**
 * Boot sweep (#706): doc brainstorms whose transcript ends on a user row
 * lost their turn to a process death — stamp an honest error row.
 */
export function sweepInterruptedDocBrainstorms(): void {
  for (const { brandId, kind, name } of listDocBrainstormKeys()) {
    try {
      const rows = readDocBrainstorm(brandId, kind, name)
      const last = rows[rows.length - 1]
      if (last?.kind !== 'user') continue
      appendDocBrainstormRow(brandId, kind, name, {
        kind: 'error',
        ts: new Date().toISOString(),
        message: 'Interrupted by a server restart before the reply finished.',
      })
    } catch (err) {
      log.error(`interrupted-turn sweep failed for ${brandId}/${kind}/${name}`, err as Error)
    }
  }
}
