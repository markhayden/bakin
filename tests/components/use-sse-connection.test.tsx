// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-sse-connection-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { cleanup, render } from '@testing-library/react'
import '../rtl-settle'
import { waitUntil } from '../helpers/wait'
import { useSSE } from '../../packages/sdk/src/hooks/use-sse'
import { usePluginEvent } from '../../packages/sdk/src/hooks/use-plugin-event'

interface MockEventSource {
  onmessage: ((e: { data: string }) => void) | null
  onopen: (() => void) | null
  onerror: ((e?: unknown) => void) | null
  url: string
  readyState: number
  close: () => void
}
const sources: MockEventSource[] = []
function createMockEventSource(url: string): MockEventSource {
  const es: MockEventSource = { onmessage: null, onopen: null, onerror: null, url, readyState: 0, close() { es.readyState = 2 } }
  sources.push(es)
  return es
}
;(createMockEventSource as unknown as { CLOSED: number }).CLOSED = 2

let reconciles = 0
let fetchMock: ReturnType<typeof mock>

function Probe() {
  useSSE()
  usePluginEvent('bakin.reconcile', () => { reconciles += 1 })
  return null
}

const fetchedUrls = () => fetchMock.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  sources.length = 0
  reconciles = 0
  ;(globalThis as { EventSource: unknown }).EventSource = createMockEventSource as unknown
  fetchMock = mock(async () => Response.json({ events: [] }))
  ;(globalThis as { fetch: unknown }).fetch = fetchMock
})

afterEach(() => cleanup())

describe('useSSE — one activity refresh per successful connection', () => {
  it('fetches nothing before the stream opens', async () => {
    render(<Probe />)
    await waitUntil(() => sources.length === 1, { label: 'first EventSource' })
    expect(fetchedUrls()).toEqual([])
  })

  it('refreshes activity once on first open and once per reconnect (through the real backoff)', async () => {
    render(<Probe />)
    await waitUntil(() => sources.length === 1, { label: 'first EventSource' })

    sources[0]!.onopen?.()
    await waitUntil(() => fetchedUrls().length === 1, { label: 'refresh after first open' })
    expect(fetchedUrls()).toEqual(['/api/activity'])
    await waitUntil(() => reconciles === 1, { label: 'reconcile after first open' })

    // Server drops the stream: the hook backs off (1 s) and reconnects.
    sources[0]!.onerror?.()
    await waitUntil(() => sources.length === 2, { label: 'reconnect EventSource', timeoutMs: 5000 })
    expect(fetchedUrls()).toEqual(['/api/activity'])

    sources[1]!.onopen?.()
    await waitUntil(() => fetchedUrls().length === 2, { label: 'refresh after reconnect' })
    expect(fetchedUrls()).toEqual(['/api/activity', '/api/activity'])
    await waitUntil(() => reconciles === 2, { label: 'reconcile after reconnect' })
  })

  it('workflow, approval and file events trigger no host-store fetch', async () => {
    render(<Probe />)
    await waitUntil(() => sources.length === 1, { label: 'first EventSource' })
    sources[0]!.onopen?.()
    await waitUntil(() => fetchedUrls().length === 1, { label: 'refresh after open' })

    const send = (payload: unknown) => sources[0]!.onmessage?.({ data: JSON.stringify(payload) })
    send({ type: 'plugin-event', event: 'workflow.gate_pending', taskId: 't-1' })
    send({ type: 'plugin-event', event: 'workflow.complete', taskId: 't-1' })
    send({ type: 'plugin-event', event: 'approval.pending', approvalId: 'a-1' })
    send({ file: 'heartbeats/main.json', event: 'change', timestamp: new Date().toISOString() })

    expect(fetchedUrls()).toEqual(['/api/activity'])
  })
})
