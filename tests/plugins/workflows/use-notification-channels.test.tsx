// @vitest-environment jsdom
/**
 * useNotificationChannels — module-level cache + single-flight fetch.
 *
 * Verifies two concurrent callers share one fetch round-trip, the hook
 * returns empty array on fetch failure, and __resetNotificationChannelsCache
 * clears state between tests.
 */
import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { render, waitFor, act } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-channels-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  useNotificationChannels,
  getChannelLabel,
  getChannelInitials,
  __resetNotificationChannelsCache,
} from '../../../plugins/workflows/hooks/use-notification-channels'
import { settleFor } from '../../helpers/wait'

const MOCK_CHANNELS = [
  { runtime: 'builtin' as const, id: 'general',       label: 'General',       initials: 'GE', icon: 'MessageSquare' },
  { runtime: 'builtin' as const, id: 'email',         label: 'Email',         initials: 'EM', icon: 'Mail' },
  { runtime: 'builtin' as const, id: 'announcements', label: 'Announcements', initials: 'AN', icon: 'MessageSquare' },
]

let fetchSpy: ReturnType<typeof spyOn> | null = null

function mockFetch(delay = 0) {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
    new Promise((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({ channels: MOCK_CHANNELS }), { status: 200 })), delay)
    })) as unknown as typeof fetch,
  )
}

function Probe({ onChannels }: { onChannels: (c: unknown[]) => void }) {
  const channels = useNotificationChannels()
  onChannels(channels)
  return null
}

beforeEach(() => {
  __resetNotificationChannelsCache()
  fetchSpy?.mockRestore()
  fetchSpy = null
})

describe('useNotificationChannels', () => {
  it('fetches channels on first mount and returns them to consumers', async () => {
    mockFetch()
    const seen: unknown[][] = []
    render(<Probe onChannels={(c) => seen.push(c)} />)

    await waitFor(() => expect(seen[seen.length - 1]).toHaveLength(3))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('coalesces two concurrent mounts into a single fetch', async () => {
    mockFetch(30)
    const seen: unknown[][] = []
    // Two components mount synchronously in the same paint — both see
    // cached === null and kick off fetchChannels(), but the in-flight
    // promise should be shared.
    render(
      <>
        <Probe onChannels={(c) => seen.push(c)} />
        <Probe onChannels={(c) => seen.push(c)} />
      </>
    )
    await waitFor(() => expect(seen.filter(c => c.length === 3).length).toBeGreaterThanOrEqual(2))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array when the fetch fails', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom') as never)
    const seen: unknown[][] = []
    render(<Probe onChannels={(c) => seen.push(c)} />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    // After the rejection settles, the probe gets a re-render with cached = []
    // (state starts as empty; fetch failure just persists that).
    await act(async () => {
      await settleFor(20, 'a failed fetch must leave the cached list empty — no late population is the assertion')
    })
    expect(seen[seen.length - 1]).toEqual([])
  })
})

describe('getChannelLabel / getChannelInitials', () => {
  it('returns a registered channel label', () => {
    expect(getChannelLabel('email', MOCK_CHANNELS)).toBe('Email')
  })

  it('falls back to the raw id for unknown channels', () => {
    expect(getChannelLabel('mastodon', MOCK_CHANNELS)).toBe('mastodon')
  })

  it('returns registered initials when available', () => {
    expect(getChannelInitials('email', MOCK_CHANNELS)).toBe('EM')
  })

  it('derives uppercase initials from id for unknown channels', () => {
    expect(getChannelInitials('bluesky', MOCK_CHANNELS)).toBe('BL')
  })
})
