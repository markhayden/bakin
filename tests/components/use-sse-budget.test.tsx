// @vitest-environment jsdom
/**
 * useSSE — budget.incident_opened wiring (cost-control v2): fires a browser
 * notification through the shared bell mechanism and lands an activity entry;
 * resolutions refresh surfaces but never notify.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-sse-budget-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const notifications: Array<{ title: string; body: string }> = []
mock.module('@/lib/browser-notify', () => ({
  sendBrowserNotification: (title: string, body: string) => { notifications.push({ title, body }) },
}))

import { render, waitFor } from '@testing-library/react'
import { useSSE } from '@/hooks/use-sse'
import { useContentStore } from '@/hooks/use-content-store'

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

function emitPluginSse(event: string, data: Record<string, unknown> = {}) {
  lastES?.onmessage?.({ data: JSON.stringify({ type: 'plugin-event', event, timestamp: new Date().toISOString(), ...data }) })
}

beforeEach(() => {
  lastES = null
  notifications.length = 0
  ;(globalThis as { EventSource: unknown }).EventSource = createMockEventSource as unknown
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async () => new Response('{}', { status: 200 }))) as unknown as typeof fetch
})

describe('useSSE — budget incident wiring', () => {
  it('fires a browser notification + activity entry on budget.incident_opened', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    emitPluginSse('budget.incident_opened', {
      incidentId: 3,
      scope: 'global',
      lane: 'metered',
      window: 'daily',
      message: "Budget alert: global daily metered spend $11.00 of $10.00 — cap reached — dispatch defers until the window resets or the cap is raised.",
    })

    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Budget alert')
    expect(notifications[0].body).toContain('$11.00 of $10.00')

    const entry = useContentStore.getState().activityEvents.find((e) => e.eventName === 'budget.incident_opened')
    expect(entry).toBeDefined()
    expect(entry?.data).toMatchObject({ incidentId: 3, scope: 'global', lane: 'metered' })
  })

  it('does not notify on budget.incident_resolved', async () => {
    render(<Probe />)
    await waitFor(() => expect(lastES).not.toBeNull())

    emitPluginSse('budget.incident_resolved', { incidentId: 3, resolution: 'raised' })
    expect(notifications).toHaveLength(0)
  })
})
