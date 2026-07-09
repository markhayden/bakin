// @vitest-environment jsdom
/**
 * useSSE — turn-activity fan-out (T9): ephemeral live-turn chips ride the
 * shared plugin-event emitter (board cards + team timeline subscribe there),
 * and deliberately do NOT land in the activity feed — the agent's own
 * progress logs stay the durable record.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-sse-turn-activity-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { render, waitFor } from '@testing-library/react'
import { useSSE } from '@/hooks/use-sse'
import { useContentStore } from '@/hooks/use-content-store'
import { usePluginEvent, type PluginEventPayload } from '@/hooks/use-plugin-event'

interface MockEventSource {
  onmessage: ((e: { data: string }) => void) | null
  onopen: (() => void) | null
  onerror: ((e?: unknown) => void) | null
  url: string
  close: () => void
}
let lastES: MockEventSource | null = null
function createMockEventSource(url: string): MockEventSource {
  const es: MockEventSource = { onmessage: null, onopen: null, onerror: null, url, close() {} }
  lastES = es
  return es
}

const received: PluginEventPayload[] = []

function Probe() {
  useSSE()
  usePluginEvent('turn-activity', (payload) => { received.push(payload) })
  return null
}

beforeEach(() => {
  lastES = null
  received.length = 0
  ;(globalThis as { EventSource: unknown }).EventSource = createMockEventSource as unknown
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async () => new Response('{}', { status: 200 }))) as unknown as typeof fetch
})

describe('useSSE — turn-activity fan-out', () => {
  it('fans turn-activity events out to plugin-event subscribers with the full payload', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    lastES!.onmessage!({
      data: JSON.stringify({
        type: 'turn-activity',
        taskId: 't-1',
        agentId: 'jessica',
        runId: 'task:t-1:d1',
        chunk: { type: 'tool', data: { toolName: 'web_fetch', phase: 'call' } },
        ts: new Date().toISOString(),
      }),
    })

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      event: 'turn-activity',
      taskId: 't-1',
      agentId: 'jessica',
      runId: 'task:t-1:d1',
      chunk: { type: 'tool', data: { toolName: 'web_fetch' } },
    })
  })

  it('never writes turn-activity into the activity feed', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())
    const before = useContentStore.getState().activityEvents.length

    lastES!.onmessage!({
      data: JSON.stringify({
        type: 'turn-activity',
        taskId: 't-2',
        agentId: 'jessica',
        runId: 'task:t-2:d1',
        chunk: { type: 'status', content: 'thinking' },
        ts: new Date().toISOString(),
      }),
    })

    expect(received).toHaveLength(1)
    expect(useContentStore.getState().activityEvents.length).toBe(before)
  })
})
