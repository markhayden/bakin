// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from '@testing-library/react'
import '../rtl-settle'
import { useHostStore } from '../../packages/sdk/src/hooks/use-host-store'
import type { ActivityEvent } from '../../packages/sdk/src/types'

function event(id: string, ts: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id, ts, type: 'log', agent: 'pixel', message: id, ...extra }
}

beforeEach(() => {
  act(() => { useHostStore.setState({ connected: false, debug: false, activityEvents: [] }, false) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useHostStore — shape', () => {
  it('holds only host state: connection, debug, activity', () => {
    const state = useHostStore.getState()
    expect(Object.keys(state).sort()).toEqual([
      'activityEvents', 'appendActivityEvent', 'connected', 'debug', 'refreshActivity', 'setConnected', 'setDebug', 'toggleDebug',
    ])
  })
})

describe('useHostStore — refreshActivity', () => {
  it('fetches only /api/activity', async () => {
    const fetchMock = mock(async (_url: RequestInfo | URL) => Response.json({ events: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { await useHostStore.getState().refreshActivity() })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/activity'])
  })

  it('merges the snapshot with live events: one row per id, newest first', async () => {
    act(() => {
      useHostStore.getState().appendActivityEvent(event('live-only', '2026-10-26T20:00:05.000Z'))
      useHostStore.getState().appendActivityEvent(event('both', '2026-10-26T20:00:03.000Z'))
    })
    vi.stubGlobal('fetch', mock(async () => Response.json({ events: [
      event('both', '2026-10-26T20:00:03.000Z'),
      event('snapshot-only', '2026-10-26T20:00:01.000Z'),
    ] })))
    await act(async () => { await useHostStore.getState().refreshActivity() })
    expect(useHostStore.getState().activityEvents.map((e) => e.id)).toEqual(['live-only', 'both', 'snapshot-only'])
  })

  it('keeps distinct same-instant entries distinct', async () => {
    vi.stubGlobal('fetch', mock(async () => Response.json({ events: [
      event('log:t:2026-10-26T20:00:00.000Z:pixel:a', '2026-10-26T20:00:00.000Z'),
      event('log:t:2026-10-26T20:00:00.000Z:pixel:b', '2026-10-26T20:00:00.000Z'),
    ] })))
    await act(async () => { await useHostStore.getState().refreshActivity() })
    expect(useHostStore.getState().activityEvents).toHaveLength(2)
  })

  it('caps the feed at 100 rows', async () => {
    const many = Array.from({ length: 150 }, (_, i) => event(`e-${i}`, new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()))
    vi.stubGlobal('fetch', mock(async () => Response.json({ events: many })))
    await act(async () => { await useHostStore.getState().refreshActivity() })
    const ids = useHostStore.getState().activityEvents.map((e) => e.id)
    expect(ids).toHaveLength(100)
    expect(ids[0]).toBe('e-149')
  })

  it('discards a response older than the latest request', async () => {
    const resolvers: Array<(r: Response) => void> = []
    vi.stubGlobal('fetch', mock(() => new Promise<Response>((resolve) => { resolvers.push(resolve) })))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = useHostStore.getState().refreshActivity()
      second = useHostStore.getState().refreshActivity()
    })
    await act(async () => {
      resolvers[1]!(Response.json({ events: [event('newer', '2026-10-26T20:00:02.000Z')] }))
      await second
      resolvers[0]!(Response.json({ events: [event('stale', '2026-10-26T20:00:09.000Z')] }))
      await first
    })
    expect(useHostStore.getState().activityEvents.map((e) => e.id)).toEqual(['newer'])
  })

  it('leaves the feed untouched when the fetch fails', async () => {
    act(() => { useHostStore.getState().appendActivityEvent(event('kept', '2026-10-26T20:00:00.000Z')) })
    vi.stubGlobal('fetch', mock(async () => { throw new TypeError('offline') }))
    await act(async () => { await useHostStore.getState().refreshActivity() })
    expect(useHostStore.getState().activityEvents.map((e) => e.id)).toEqual(['kept'])
  })
})
