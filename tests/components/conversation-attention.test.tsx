// @vitest-environment jsdom
/**
 * Kit attention rules + useConversationAttention provider hook (#703).
 * The pure rules are chat's S6 suppression matrix generalized to thread
 * keys; the hook is ChatBadgeProvider's mechanics (badge, inflight set,
 * toast/chime/OS fanout, title prefix) as a reusable building block.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conv-attention-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'

import {
  attentionForDone,
  badgeFor,
  visibleIdFromLocation,
  withUnreadPrefix,
  useConversationAttention,
  type ConversationAttentionConfig,
} from '@makinbakin/sdk/components'
import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import { getNavBadge } from '@makinbakin/sdk'

const SETTINGS = { sound: true, toasts: true }

describe('attention rules (pure)', () => {
  it('viewing the thread: silent, mark seen', () => {
    expect(attentionForDone({ key: 'a', agentId: 'main', preview: 'hi' }, { visibleKey: 'a', settings: SETTINGS }))
      .toEqual({ toast: false, sound: false, browserNotification: false, markSeen: true })
  })

  it('elsewhere: toast + sound + OS notification, no seen; settings gate toast/sound', () => {
    expect(attentionForDone({ key: 'a', agentId: 'main', preview: 'hi' }, { visibleKey: 'b', settings: SETTINGS }))
      .toEqual({ toast: true, sound: true, browserNotification: true, markSeen: false })
    expect(
      attentionForDone({ key: 'a', agentId: 'main' }, { visibleKey: '', settings: { sound: false, toasts: false } }),
    ).toEqual({ toast: false, sound: false, browserNotification: true, markSeen: false })
  })

  it('aborted turns notify nothing (seen only when viewing)', () => {
    expect(attentionForDone({ key: 'a', agentId: 'main', aborted: true }, { visibleKey: 'a', settings: SETTINGS }))
      .toEqual({ toast: false, sound: false, browserNotification: false, markSeen: true })
    expect(attentionForDone({ key: 'a', agentId: 'main', aborted: true }, { visibleKey: '', settings: SETTINGS }))
      .toEqual({ toast: false, sound: false, browserNotification: false, markSeen: false })
  })

  it('visibleIdFromLocation parses <base>/<id> with exclusions and decoding (chat contract)', () => {
    expect(visibleIdFromLocation('/chat/abc-123', '/chat', { exclude: ['new'] })).toBe('abc-123')
    expect(visibleIdFromLocation('/chat/abc-123/', '/chat')).toBe('abc-123')
    expect(visibleIdFromLocation('/chat/new', '/chat', { exclude: ['new'] })).toBe('')
    expect(visibleIdFromLocation('/chat', '/chat')).toBe('')
    expect(visibleIdFromLocation('/chat/a%20b', '/chat')).toBe('a b')
    expect(visibleIdFromLocation('/chat/a/b', '/chat')).toBe('')
    expect(visibleIdFromLocation('/projects/p1', '/projects')).toBe('p1')
  })

  it('badgeFor: count wins, working dot second, null when idle', () => {
    expect(badgeFor(3, 1)).toEqual({ count: 3, tone: 'attention' })
    expect(badgeFor(0, 2)).toEqual({ tone: 'info' })
    expect(badgeFor(0, 0)).toBeNull()
  })

  it('withUnreadPrefix is idempotent and caps at 99+', () => {
    expect(withUnreadPrefix('Bakin', 2)).toBe('(2) Bakin')
    expect(withUnreadPrefix('(2) Bakin', 5)).toBe('(5) Bakin')
    expect(withUnreadPrefix('(5) Bakin', 0)).toBe('Bakin')
    expect(withUnreadPrefix('Bakin', 150)).toBe('(99+) Bakin')
  })
})

const EVENTS = { chunk: 'probe2.chunk', done: 'probe2.done', error: 'probe2.error' }

function makeConfig(overrides?: Partial<ConversationAttentionConfig>): {
  config: ConversationAttentionConfig
  calls: { toasts: Array<string>; chimes: number; refreshes: number }
  setTotals: (unread: number, inflight: string[]) => void
} {
  const calls = { toasts: [] as string[], chimes: 0, refreshes: 0 }
  let totals = { unreadTotal: 0, inflightKeys: [] as string[] }
  const config: ConversationAttentionConfig = {
    pluginId: 'probe2',
    navItemId: 'probe2-nav',
    events: EVENTS,
    keyOf: (p) => String(p.threadKey ?? ''),
    visibleKey: () => 'visible-thread',
    refreshTotals: async () => {
      calls.refreshes += 1
      return totals
    },
    renderToast: (payload) => {
      calls.toasts.push(`reply:${payload.key}`)
      return `reply:${payload.key}`
    },
    osNotification: (payload) => ({ title: `${payload.agentId} replied`, body: payload.preview ?? '', href: `/x/${payload.key}` }),
    errorToast: (p) => `failed: ${String(p.message)}`,
    chime: () => { calls.chimes += 1 },
    ...overrides,
  }
  return { config, calls, setTotals: (unread, inflight) => { totals = { unreadTotal: unread, inflightKeys: inflight } } }
}

describe('useConversationAttention (provider hook)', () => {
  it('seeds totals on mount into the nav badge; chunk events add the working dot', async () => {
    const { config, setTotals } = makeConfig()
    setTotals(2, [])
    renderHook(() => useConversationAttention(config))
    await waitFor(() => expect(getNavBadge('probe2-nav')).toEqual({ count: 2, tone: 'attention' }))

    setTotals(0, [])
    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'visible-thread', agentId: 'main' })
    })
    await waitFor(() => expect(getNavBadge('probe2-nav')).toBeUndefined())
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 't9', agentId: 'main' })
    })
    await waitFor(() => expect(getNavBadge('probe2-nav')).toEqual({ tone: 'info' }))
  })

  it('started events light the working dot before any chunk arrives (#707)', async () => {
    const { config } = makeConfig({ events: { ...EVENTS, started: 'probe2.started' } })
    renderHook(() => useConversationAttention(config))
    await act(async () => {})
    expect(getNavBadge('probe2-nav')).toBeUndefined()

    act(() => {
      emitPluginEvent({ event: 'probe2.started', threadKey: 't1', agentId: 'main' })
    })
    await waitFor(() => expect(getNavBadge('probe2-nav')).toEqual({ tone: 'info' }))

    // The done clears the started-seeded key even when no chunk ever fired.
    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 't1', agentId: 'main' })
    })
    await waitFor(() => expect(getNavBadge('probe2-nav')).toBeUndefined())
  })

  it('done while elsewhere: toast + chime + refresh; done while viewing: silent', async () => {
    const { config, calls } = makeConfig()
    renderHook(() => useConversationAttention(config))
    await act(async () => {})
    const refreshesAfterMount = calls.refreshes

    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'other-thread', agentId: 'main', preview: 'hello' })
    })
    expect(calls.toasts).toEqual(['reply:other-thread'])
    expect(calls.chimes).toBe(1)
    expect(calls.refreshes).toBeGreaterThan(refreshesAfterMount)

    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'visible-thread', agentId: 'main', preview: 'hi' })
    })
    expect(calls.toasts).toHaveLength(1)
    expect(calls.chimes).toBe(1)
  })

  it('aborted done and disabled settings stay silent', async () => {
    const { config, calls } = makeConfig({ settings: () => ({ sound: false, toasts: false }) })
    renderHook(() => useConversationAttention(config))
    await act(async () => {})
    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'elsewhere', agentId: 'main', preview: 'x', aborted: true })
      emitPluginEvent({ event: EVENTS.done, threadKey: 'elsewhere', agentId: 'main', preview: 'y' })
    })
    expect(calls.toasts).toHaveLength(0)
    expect(calls.chimes).toBe(0)
  })

  it('error off-screen raises the error toast; on-screen stays silent', async () => {
    const { config } = makeConfig()
    const before = useToastStore.getState().toasts.length
    renderHook(() => useConversationAttention(config))
    await act(async () => {})
    await act(async () => {
      emitPluginEvent({ event: EVENTS.error, threadKey: 'other', agentId: 'main', message: 'boom' })
    })
    const after = useToastStore.getState().toasts
    expect(after.length).toBe(before + 1)
    expect(String(after[after.length - 1]?.message)).toContain('failed: boom')

    await act(async () => {
      emitPluginEvent({ event: EVENTS.error, threadKey: 'visible-thread', agentId: 'main', message: 'quiet' })
    })
    expect(useToastStore.getState().toasts.length).toBe(before + 1)
  })

  it('maintains the (N) tab-title prefix when enabled', async () => {
    const { config, setTotals } = makeConfig({ titlePrefix: true })
    document.title = 'Bakin'
    setTotals(4, [])
    renderHook(() => useConversationAttention(config))
    await waitFor(() => expect(document.title).toBe('(4) Bakin'))
    setTotals(0, [])
    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'visible-thread', agentId: 'main' })
    })
    await waitFor(() => expect(document.title).toBe('Bakin'))
  })
})
