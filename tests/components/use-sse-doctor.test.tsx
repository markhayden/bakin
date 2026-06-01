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
import { useSSE } from '@/hooks/use-sse'
import { useContentStore } from '@/hooks/use-content-store'

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
  return null
}

function emitAudit(event: string) {
  lastES?.onmessage?.({
    data: JSON.stringify({ type: 'audit', entry: { event, ts: new Date().toISOString(), agent: 'system', data: {} } }),
  })
}

beforeEach(() => {
  lastES = null
  useContentStore.setState({ doctorVersion: 0 })
  ;(globalThis as { EventSource: unknown }).EventSource = createMockEventSource as unknown
  // initialize() fetches a few endpoints on mount — stub them to empty.
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async () => new Response('{}', { status: 200 }))) as unknown as typeof fetch
})

afterEach(() => {
  // Reset doctorVersion for isolation.
  useContentStore.setState({ doctorVersion: 0 })
})

describe('useSSE — doctorVersion wiring', () => {
  it('bumps doctorVersion on a doctor.run audit event', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    expect(useContentStore.getState().doctorVersion).toBe(0)
    emitAudit('doctor.run')
    expect(useContentStore.getState().doctorVersion).toBe(1)
    emitAudit('doctor.run')
    expect(useContentStore.getState().doctorVersion).toBe(2)
  })

  it('does NOT bump doctorVersion on a non-doctor audit event', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    emitAudit('task.created')
    emitAudit('plan.updated')
    expect(useContentStore.getState().doctorVersion).toBe(0)
  })
})
