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

import type { MessageUsage } from '@bakin/core/adapters/runtime'

import { conversationThreadId } from '../../../src/components/conversation/thread-id'
import { createConversationTurnService } from '../../../src/core/conversation-turns'
import { createLogger } from '../../../src/core/logger'
import { appendDocBrainstormRow, getBrand, type BrandDocKind } from './store'

const log = createLogger('brands-brainstorm')

/** Composite thread key `<brandId>/<kind>/<name>` (no segment may contain '/'). */
export function docBrainstormKey(brandId: string, kind: BrandDocKind, name: string): string {
  return `${brandId}/${kind}/${name}`
}

function parseKey(key: string): { brandId: string; kind: BrandDocKind; name: string } {
  const [brandId, kind, name] = key.split('/')
  return { brandId, kind: kind as BrandDocKind, name }
}

async function meterBrainstormTurn(key: string, agentId: string, turnId: string, usage: MessageUsage | undefined): Promise<void> {
  try {
    const { meterAgentTurn } = await import('../../../src/core/agent-cost')
    await meterAgentTurn({
      runId: `brainstorm:brands:${key}:turn:${turnId}`,
      agent: agentId,
      activityClass: 'user',
      workClass: 'chat',
      result: { id: turnId, content: '', ...(usage ? { usage } : {}) },
    })
  } catch (err) {
    log.error(`brainstorm metering failed for ${key}`, err as Error)
  }
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
    meter: ({ key, agentId, turnId, usage }) => meterBrainstormTurn(key, agentId, turnId, usage),
  },
})
