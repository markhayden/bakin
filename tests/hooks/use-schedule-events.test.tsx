// @vitest-environment jsdom
/**
 * The schedule hooks ride the shell's ONE event stream (#990): they refetch on
 * `schedule.*` audit events, task-board writes, any provider's
 * `<pluginId>.scheduled_events_changed` audit event and reconnects — and on
 * nothing else. No private EventSource.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-schedule-events-${Date.now()}`)
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { act, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { emitPluginEvent } from '@/hooks/use-plugin-event'
import { useOccurrences, useScheduleJobs } from '@/hooks/use-schedule'
import { settleFor } from '../helpers/wait'

const realFetch = globalThis.fetch
let jobFetches = 0
let occurrenceFetches = 0
let eventSources = 0
const realEventSource = (globalThis as { EventSource?: unknown }).EventSource

beforeEach(() => {
  jobFetches = 0
  occurrenceFetches = 0
  eventSources = 0
  ;(globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/occurrences')) occurrenceFetches += 1
    else if (url.endsWith('/api/plugins/schedule/')) jobFetches += 1
    return new Response(JSON.stringify({ jobs: [], occurrences: [] }), { status: 200 })
  }) as typeof fetch
  ;(globalThis as { EventSource: unknown }).EventSource = function () { eventSources += 1 } as unknown
})
afterEach(() => {
  globalThis.fetch = realFetch
  ;(globalThis as { EventSource?: unknown }).EventSource = realEventSource
})

const audit = (event: string) => act(() => { emitPluginEvent({ event: 'bakin.audit', entry: { event } }) })
const changed = () => act(() => { emitPluginEvent({ event: 'schedule.changed' }) })

describe('useScheduleJobs', () => {
  it('refetches on schedule.changed and reconnects, never on an audit, and opens no stream', async () => {
    renderHook(() => useScheduleJobs())
    await waitFor(() => expect(jobFetches).toBe(1))

    await changed()
    await waitFor(() => expect(jobFetches).toBe(2))
    await audit('schedule.fire_skipped')
    await audit('task.created')
    await act(() => { emitPluginEvent({ event: 'bakin.reconcile' }) })
    await waitFor(() => expect(jobFetches).toBe(3))
    expect(eventSources).toBe(0)
  })

  it('a burst of writes costs at most one trailing request, never one per write', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    renderHook(() => useScheduleJobs())
    await waitFor(() => expect(jobFetches).toBe(1))
    const realFetchStub = globalThis.fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
      await gate
      return realFetchStub(input)
    }) as typeof fetch
    await act(() => { for (let i = 0; i < 20; i += 1) emitPluginEvent({ event: 'schedule.changed' }) })
    await act(async () => { release() })
    await waitFor(() => expect(jobFetches).toBe(3))
    await settleFor(50, 'no request beyond the one trailing refresh')
    expect(jobFetches).toBe(3)
  })
})

describe('useOccurrences', () => {
  it('refetches on schedule.changed, board writes and any provider’s scheduled_events_changed — nothing else', async () => {
    renderHook(() => useOccurrences('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'))
    await waitFor(() => expect(occurrenceFetches).toBe(1))

    await changed()
    await waitFor(() => expect(occurrenceFetches).toBe(2))
    await act(() => { emitPluginEvent({ event: 'taskboard' }) })
    await waitFor(() => expect(occurrenceFetches).toBe(3))
    // The documented provider convention (#191) — an audit, nested under entry.event.
    await audit('messaging.scheduled_events_changed')
    await waitFor(() => expect(occurrenceFetches).toBe(4))
    await audit('assets.asset_changed')
    expect(occurrenceFetches).toBe(4)
    expect(eventSources).toBe(0)
  })
})
