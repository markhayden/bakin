import { beforeEach, describe, expect, it } from 'bun:test'

import { clearUsage, getUsageFeed, recordUsage } from '../../src/core/usage'
import { createRuntimeToolUsageRecorder } from '../../src/core/runtime-tool-usage'

describe('createRuntimeToolUsageRecorder', () => {
  beforeEach(() => clearUsage())

  it('records one completed runtime-native tool interaction with its agent and source', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-web',
      threadId: 'chat:chat-1',
      phase: 'call',
      callId: 'call-web',
      toolName: 'web_search',
      status: 'running',
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-web',
      threadId: 'chat:chat-1',
      phase: 'result',
      callId: 'call-web',
      toolName: 'web_search',
      status: 'completed',
      durationMs: 240,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
    expect(feed.recent[0]).toMatchObject({
      kind: 'mcp',
      activityClass: 'user',
      name: 'web_search',
      agent: 'main',
      durationMs: 240,
      status: 'ok',
      meta: { source: 'runtime-native', callId: 'call-web', threadId: 'chat:chat-1' },
    })
  })

  it('preserves a direct aborted tool result and counts routine cancellation without a routine opt-in', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'routine',
      turnId: 'turn-aborted-result',
      threadId: 'chat:chat-1',
      phase: 'result',
      callId: 'call-aborted-result',
      toolName: 'web_search',
      status: 'aborted',
      durationMs: 12,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.outcomes).toEqual({ failed: 0, unverified: 0, canceled: 1, succeeded: 0 })
    expect(feed.recent).toHaveLength(1)
    expect(feed.recent[0]).toMatchObject({
      name: 'web_search',
      activityClass: 'routine',
      status: 'ok',
      meta: {
        source: 'runtime-native',
        callId: 'call-aborted-result',
        terminalStatus: 'aborted',
      },
    })
    expect(feed.recent[0].meta?.resultMissing).toBeUndefined()
  })

  it('reconciles Bakin exec results with their source record instead of counting them twice', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-bakin',
      phase: 'call',
      callId: 'call-bakin',
      toolName: 'bakin_exec_images_generate',
      status: 'running',
    })
    recordUsage({
      kind: 'mcp',
      activityClass: 'user',
      name: 'bakin_exec_images_generate',
      agent: 'main',
      durationMs: 10,
      status: 'ok',
      meta: { via: 'runtime-native' },
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-bakin',
      phase: 'result',
      callId: 'call-bakin',
      toolName: 'bakin_exec_images_generate',
      status: 'completed',
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-browser',
      phase: 'result',
      callId: 'call-browser',
      toolName: 'browser.navigate',
      status: 'failed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 1, errorRate: 0.5 })
    expect(feed.recent.filter((entry) => entry.name === 'bakin_exec_images_generate')).toHaveLength(1)
    expect(feed.recent.find((entry) => entry.name === 'browser.navigate')).toMatchObject({
      name: 'browser.navigate',
      status: 'error',
    })
  })

  it('records a failed Bakin exec result when validation or transport failed before source metering', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-invalid',
      phase: 'call',
      callId: 'call-invalid',
      toolName: 'bakin_exec_tasks_get',
      status: 'running',
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-invalid',
      phase: 'result',
      callId: 'call-invalid',
      toolName: 'bakin_exec_tasks_get',
      status: 'failed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
    expect(feed.recent[0]).toMatchObject({
      name: 'bakin_exec_tasks_get',
      status: 'error',
      meta: { source: 'runtime-native-observer', callId: 'call-invalid' },
    })
  })

  it('upgrades a source-recorded Bakin success when the runtime reports that its response failed', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-lost-response',
      phase: 'call',
      callId: 'call-lost-response',
      toolName: 'bakin_exec_tasks_list',
      status: 'running',
    })
    recordUsage({
      kind: 'mcp',
      activityClass: 'user',
      name: 'bakin_exec_tasks_list',
      agent: 'main',
      durationMs: 5,
      status: 'ok',
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-lost-response',
      phase: 'result',
      callId: 'call-lost-response',
      toolName: 'bakin_exec_tasks_list',
      status: 'failed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 1, errorRate: 1 })
    expect(feed.recent[0]).toMatchObject({ name: 'bakin_exec_tasks_list', status: 'error' })
  })

  it('records result-only Bakin observations independently without an explicit call-start cursor', () => {
    const record = createRuntimeToolUsageRecorder()

    recordUsage({
      kind: 'mcp',
      activityClass: 'routine',
      name: 'bakin_exec_heartbeat',
      agent: 'main',
      durationMs: 4,
      status: 'ok',
    })
    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-result-only',
      phase: 'result',
      callId: 'result-only',
      toolName: 'bakin_exec_heartbeat',
      status: 'completed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h', includeRoutine: true })
    expect(feed.totals).toEqual({ count: 2, errors: 0, errorRate: 0 })
    expect(feed.recent.filter((entry) => entry.name === 'bakin_exec_heartbeat')).toHaveLength(2)
    expect(feed.recent.map((entry) => entry.activityClass)).toEqual(['routine', 'user'])
  })

  it('never rewrites a previous success when a later started Bakin call fails before source metering', () => {
    const record = createRuntimeToolUsageRecorder()

    recordUsage({
      kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_get', agent: 'main',
      durationMs: 8, status: 'ok',
    })
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-invalid-later', phase: 'call', callId: 'invalid-later',
      toolName: 'bakin_exec_tasks_get', status: 'running',
    })
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-invalid-later', phase: 'result', callId: 'invalid-later',
      toolName: 'bakin_exec_tasks_get', status: 'failed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 1, errorRate: 0.5 })
    expect(feed.recent.filter((entry) => entry.status === 'ok')).toHaveLength(1)
    expect(feed.recent.filter((entry) => entry.status === 'error')).toHaveLength(1)
  })

  it('records normalized adapter failures and clamps invalid negative durations at the host boundary', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'user',
      turnId: 'turn-web-fetch-error',
      phase: 'result',
      toolName: 'web_fetch',
      status: 'failed',
      durationMs: -20,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.recent[0]).toMatchObject({
      name: 'web_fetch',
      status: 'error',
      durationMs: 0,
    })
  })

  it('preserves the producer-assigned activity class for background native tools', () => {
    const record = createRuntimeToolUsageRecorder()

    record({
      agentId: 'main',
      activityClass: 'system',
      turnId: 'turn-background',
      phase: 'result',
      toolName: 'web_search',
      status: 'completed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.recent[0]).toMatchObject({
      name: 'web_search',
      activityClass: 'system',
    })
  })

  it('reconciles a pending call at turn completion once and ignores its late result frame', () => {
    let now = 1_000
    const record = createRuntimeToolUsageRecorder(() => now)

    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-complete', phase: 'call',
      callId: 'call-late', toolName: 'web_search', status: 'running',
    })
    now = 1_120
    record.reconcileTurn({
      agentId: 'main', activityClass: 'user', operation: 'send', turnId: 'turn-complete',
      phase: 'result', status: 'completed', durationMs: 120,
    })
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-complete', phase: 'result',
      callId: 'call-late', toolName: 'web_search', status: 'completed', durationMs: 140,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
    expect(feed.recent[0]).toMatchObject({
      name: 'web_search',
      durationMs: 120,
      status: 'ok',
      meta: {
        source: 'runtime-native',
        turnId: 'turn-complete',
        callId: 'call-late',
        resultMissing: true,
        turnTerminalStatus: 'completed',
      },
    })
  })

  it('records a pending call on failed turns but keeps deliberate aborts neutral', () => {
    const record = createRuntimeToolUsageRecorder()

    for (const [turnId, status] of [['turn-failed', 'failed'], ['turn-aborted', 'aborted']] as const) {
      record({
        agentId: 'pixel', activityClass: 'system', turnId, phase: 'call',
        callId: `call-${status}`, toolName: 'browser.navigate', status: 'running',
      })
      record.reconcileTurn({
        agentId: 'pixel', activityClass: 'system', operation: 'stream', turnId,
        phase: 'result', status, durationMs: 20,
      })
    }

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 1, errorRate: 0.5 })
    expect(feed.recent.find((entry) => entry.meta?.turnId === 'turn-failed')).toMatchObject({
      status: 'error',
      meta: { resultMissing: true, turnTerminalStatus: 'failed' },
    })
    expect(feed.recent.find((entry) => entry.meta?.turnId === 'turn-aborted')).toMatchObject({
      status: 'ok',
      meta: { resultMissing: true, turnTerminalStatus: 'aborted' },
    })
  })

  it('marks a reconciled Bakin source row when its runtime result frame is missing', () => {
    const record = createRuntimeToolUsageRecorder()
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-bakin-missing', phase: 'call',
      callId: 'call-bakin-missing', toolName: 'bakin_exec_tasks_list', status: 'running',
    })
    recordUsage({
      kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_list', agent: 'main',
      durationMs: 8, status: 'ok', meta: { via: 'runtime-native' },
    })

    record.reconcileTurn({
      agentId: 'main', activityClass: 'user', operation: 'send', turnId: 'turn-bakin-missing',
      phase: 'result', status: 'completed', durationMs: 20,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 1, errors: 0, errorRate: 0 })
    expect(feed.recent[0]).toMatchObject({
      name: 'bakin_exec_tasks_list',
      meta: {
        via: 'runtime-native',
        resultMissing: true,
        turnTerminalStatus: 'completed',
      },
    })
  })

  it('reconciles only pending calls explicitly owned by the terminal turn', () => {
    const record = createRuntimeToolUsageRecorder()
    for (const turnId of ['turn-1', 'turn-2']) {
      record({
        agentId: 'main', activityClass: 'user', turnId, phase: 'call',
        callId: 'same-call-id', toolName: 'web_fetch', status: 'running',
      })
    }

    record.reconcileTurn({
      agentId: 'main', activityClass: 'user', operation: 'send', turnId: 'turn-1',
      phase: 'result', status: 'failed', durationMs: 10,
    })
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-2', phase: 'result',
      callId: 'same-call-id', toolName: 'web_fetch', status: 'completed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 1, errorRate: 0.5 })
    expect(feed.recent.filter((entry) => entry.meta?.turnId === 'turn-1')).toHaveLength(1)
    expect(feed.recent.filter((entry) => entry.meta?.turnId === 'turn-2')).toHaveLength(1)
  })

  it('preserves repeated same-tool starts when the runtime omits call ids', () => {
    const record = createRuntimeToolUsageRecorder()
    for (let index = 0; index < 2; index++) {
      record({
        agentId: 'main', activityClass: 'user', turnId: 'turn-no-call-ids', phase: 'call',
        toolName: 'web_search', status: 'running',
      })
    }

    record.reconcileTurn({
      agentId: 'main', activityClass: 'user', operation: 'send', turnId: 'turn-no-call-ids',
      phase: 'result', status: 'failed', durationMs: 20,
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 2, errorRate: 1 })
    expect(feed.recent.every((entry) => entry.meta?.resultMissing === true)).toBe(true)
  })

  it('never heuristically merges a result-only Bakin failure with a prior same-status source row', () => {
    const record = createRuntimeToolUsageRecorder()

    recordUsage({
      kind: 'mcp', activityClass: 'user', name: 'bakin_exec_tasks_get', agent: 'main',
      durationMs: 8, status: 'error',
    })
    record({
      agentId: 'main', activityClass: 'user', turnId: 'turn-result-only-second', phase: 'result', callId: 'result-only-second-call',
      toolName: 'bakin_exec_tasks_get', status: 'failed',
    })

    const feed = getUsageFeed({ kind: 'mcp', window: '1h' })
    expect(feed.totals).toEqual({ count: 2, errors: 2, errorRate: 1 })
    expect(feed.recent.filter((entry) => entry.name === 'bakin_exec_tasks_get')).toHaveLength(2)
  })
})
