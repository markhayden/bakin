// @vitest-environment jsdom
/** `updates.changed` reaches `usePluginEvent` through the shell's SSE handler (#1007 review r3 #2). */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
const testDir = join(tmpdir(), `bakin-use-sse-updates-${Date.now()}`)
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
import { act, cleanup, render } from '@testing-library/react'
import '../rtl-settle'
import { useSSE } from '../../packages/sdk/src/hooks/use-sse'
import { usePluginEvent } from '../../packages/sdk/src/hooks/use-plugin-event'

interface MockEventSource { onmessage: ((e: { data: string }) => void) | null; onopen: (() => void) | null; onerror: ((e?: unknown) => void) | null; url: string; close: () => void }
let lastES: MockEventSource | null = null
function createMockEventSource(url: string): MockEventSource {
  const es: MockEventSource = { onmessage: null, onopen: null, onerror: null, url, close() {} }
  lastES = es
  return es
}
const seen: unknown[] = []
function Probe() {
  useSSE()
  usePluginEvent('updates.changed', (payload) => { seen.push(payload.ids) })
  return null
}
const originalES = (globalThis as { EventSource?: unknown }).EventSource
beforeEach(() => { seen.length = 0; lastES = null; (globalThis as { EventSource?: unknown }).EventSource = createMockEventSource as unknown })
afterEach(() => { cleanup(); (globalThis as { EventSource?: unknown }).EventSource = originalES })

describe('updates.changed over SSE', () => {
  it('the engine\'s plugin-event envelope reaches a usePluginEvent subscriber; a bare type never does', async () => {
    render(<Probe />)
    await act(async () => { lastES?.onopen?.() })
    await act(async () => { lastES?.onmessage?.({ data: JSON.stringify({ type: 'updates.changed', ids: ['plugin:notes'] }) }) })
    expect(seen).toEqual([])
    await act(async () => { lastES?.onmessage?.({ data: JSON.stringify({ type: 'plugin-event', event: 'updates.changed', ids: ['plugin:notes'] }) }) })
    expect(seen).toEqual([['plugin:notes']])
  })
})
