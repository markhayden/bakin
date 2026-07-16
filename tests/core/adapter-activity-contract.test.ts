/**
 * Compile-time pins for the normalized adapter observability contract.
 *
 * The invalid cases are enforced by `bun run typecheck`; the runtime assertion
 * keeps this file visible to the normal Bun test suite as well.
 */
import { describe, expect, it } from 'bun:test'

import type { AdapterToolActivityEvent } from '../../packages/core/src/adapters/shared'

describe('adapter tool activity contract', () => {
  it('represents call and terminal result phases explicitly', () => {
    const call = {
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-1',
      phase: 'call',
      toolName: 'web_search',
      status: 'running',
    } satisfies AdapterToolActivityEvent
    const result = {
      ...call,
      phase: 'result',
      status: 'completed',
      durationMs: 10,
    } satisfies AdapterToolActivityEvent

    expect([call.phase, result.phase]).toEqual(['call', 'result'])
  })
})

// Compile-time invalid-state pins. This function is never called.
function assertInvalidToolStatesStayUnrepresentable(): void {
  // @ts-expect-error — a normalized result must state its terminal outcome
  const missingResultStatus: AdapterToolActivityEvent = { agentId: 'main', activityClass: 'user', turnId: 'turn-1', phase: 'result', toolName: 'web_search' }
  // @ts-expect-error — running is a call state, never a terminal result
  const runningResult: AdapterToolActivityEvent = { agentId: 'main', activityClass: 'user', turnId: 'turn-1', phase: 'result', toolName: 'web_search', status: 'running' }
  // @ts-expect-error — runtime-private success aliases must be normalized by the adapter
  const privateSuccessAlias: AdapterToolActivityEvent = { agentId: 'main', activityClass: 'user', turnId: 'turn-1', phase: 'result', toolName: 'web_search', status: 'success' }
  // @ts-expect-error — completed is a terminal result state, never a call state
  const completedCall: AdapterToolActivityEvent = { agentId: 'main', activityClass: 'user', turnId: 'turn-1', phase: 'call', toolName: 'web_search', status: 'completed' }

  void missingResultStatus
  void runningResult
  void privateSuccessAlias
  void completedCall
}

void assertInvalidToolStatesStayUnrepresentable
