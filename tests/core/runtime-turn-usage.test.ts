import { beforeEach, describe, expect, it } from 'bun:test'

import { createRuntimeTurnUsageRecorder } from '../../src/core/runtime-turn-usage'
import { clearUsage, getUsageFeed } from '../../src/core/usage'

describe('createRuntimeTurnUsageRecorder', () => {
  beforeEach(() => clearUsage())

  it('records one successful send with runtime-reported context usage', () => {
    const record = createRuntimeTurnUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      operation: 'send',
      phase: 'start',
      turnId: 'turn-1',
      threadId: 'chat:1',
      status: 'running',
    })
    expect(getUsageFeed({ kind: 'agent', window: '1h' }).totals.count).toBe(0)

    record({
      agentId: 'main',
      activityClass: 'user',
      operation: 'send',
      phase: 'result',
      turnId: 'turn-1',
      threadId: 'chat:1',
      resultId: 'result-1',
      status: 'completed',
      durationMs: 240,
      usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 5 },
    })

    const feed = getUsageFeed({ kind: 'agent', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
    expect(feed.recent[0]).toMatchObject({
      kind: 'agent',
      activityClass: 'user',
      name: 'send',
      agent: 'main',
      durationMs: 240,
      status: 'ok',
      tokensIn: 100,
      tokensOut: 20,
      tokensCacheRead: 80,
      tokensCacheWrite: 5,
      meta: {
        source: 'runtime-turn',
        operation: 'send',
        turnId: 'turn-1',
        threadId: 'chat:1',
        resultId: 'result-1',
      },
    })
  })

  it('records failed streams once while keeping deliberate aborts out of the failure count', () => {
    const record = createRuntimeTurnUsageRecorder()

    for (const [turnId, status] of [['turn-failed', 'failed'], ['turn-aborted', 'aborted']] as const) {
      record({
        agentId: 'pixel',
        activityClass: 'system',
        operation: 'stream',
        phase: 'result',
        turnId,
        status,
        durationMs: status === 'failed' ? 50 : -10,
      })
    }
    record({
      agentId: 'pixel',
      activityClass: 'system',
      operation: 'stream',
      phase: 'result',
      turnId: 'turn-failed',
      status: 'failed',
      durationMs: 50,
    })

    const feed = getUsageFeed({ kind: 'agent', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 1, errorRate: 0.5 })
    expect(feed.recent.find((entry) => entry.meta?.turnId === 'turn-aborted')).toMatchObject({
      name: 'stream',
      activityClass: 'system',
      durationMs: 0,
      status: 'ok',
      meta: { terminalStatus: 'aborted' },
    })
  })
})
