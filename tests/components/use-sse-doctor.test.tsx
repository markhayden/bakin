// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-sse-doctor-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { render, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { useSSE } from '@/hooks/use-sse'
import { usePluginEvent } from '@/hooks/use-plugin-event'
import { useContentStore } from '@/hooks/use-content-store'

let doctorRuns = 0

// Controllable EventSource — captures the instance so the test can drive
// onmessage directly (no real network). A factory (constructor returning an
// object) avoids aliasing `this` while still satisfying `new EventSource()`.
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

function Probe() {
  useSSE()
  usePluginEvent('doctor.run', () => { doctorRuns += 1 })
  return null
}

function emitAudit(event: string, data: Record<string, unknown> = {}, agent = 'system') {
  lastES?.onmessage?.({
    data: JSON.stringify({ type: 'audit', entry: { event, ts: new Date().toISOString(), agent, data } }),
  })
}

beforeEach(() => {
  lastES = null
  doctorRuns = 0
  ;(globalThis as { EventSource: unknown }).EventSource = createMockEventSource as unknown
  // initialize() fetches a few endpoints on mount — stub them to empty.
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async () => new Response('{}', { status: 200 }))) as unknown as typeof fetch
})

describe('useSSE — doctor.run event wiring', () => {
  it('emits a doctor.run plugin event on a doctor.run audit event', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    expect(doctorRuns).toBe(0)
    emitAudit('doctor.run')
    expect(doctorRuns).toBe(1)
    emitAudit('doctor.run')
    expect(doctorRuns).toBe(2)
  })

  it('does NOT emit doctor.run on a non-doctor audit event', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    emitAudit('task.created')
    emitAudit('plan.updated')
    expect(doctorRuns).toBe(0)
  })

  it('preserves structured audit data on activity events', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    emitAudit('task.dispatch_failed', {
      title: 'Provider failed task',
      category: 'model_provider_unavailable',
      reasonCode: 'provider_cooldown',
      provider: 'openai-codex',
      retryable: true,
    }, 'main')

    const [event] = useContentStore.getState().activityEvents
    expect(event.message).toBe('Dispatch failed: model provider unavailable')
    expect(event.data).toMatchObject({
      reasonCode: 'provider_cooldown',
      provider: 'openai-codex',
      retryable: true,
    })
  })
})
