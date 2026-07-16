// @vitest-environment jsdom
/**
 * Chat attention system (T5.1) — the pure suppression rules
 * (attention.ts) and the ChatBadgeProvider's observable effects: nav
 * badge (count / working dot), tab-title prefix, toast on
 * reply-while-elsewhere via synthetic plugin events.
 */
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-chat-attn-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, chat: join(testDir, 'chat'), db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { act, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'

import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import { getNavBadge } from '@makinbakin/sdk'

import {
  attentionForDone,
  badgeFor,
  visibleChatIdFromLocation,
  withUnreadPrefix,
} from '../../../plugins/chat/components/attention'
import { ChatBadgeProvider } from '../../../plugins/chat/components/chat-badge-provider'

const SETTINGS = { sound: true, toasts: true }

describe('attentionForDone (pure rules)', () => {
  it('reply while viewing the chat: no fanfare, mark seen', () => {
    const actions = attentionForDone(
      { chatId: 'c1', agentId: 'main', preview: 'hi' },
      { visibleChatId: 'c1', settings: SETTINGS },
    )
    expect(actions).toEqual({ toast: false, sound: false, browserNotification: false, markSeen: true })
  })

  it('reply while elsewhere: toast + sound + browser notification', () => {
    const actions = attentionForDone(
      { chatId: 'c1', agentId: 'main', preview: 'hi' },
      { visibleChatId: '', settings: SETTINGS },
    )
    expect(actions).toEqual({ toast: true, sound: true, browserNotification: true, markSeen: false })
  })

  it('settings toggles silence toast/sound independently', () => {
    const actions = attentionForDone(
      { chatId: 'c1', agentId: 'main' },
      { visibleChatId: '', settings: { sound: false, toasts: false } },
    )
    expect(actions.toast).toBe(false)
    expect(actions.sound).toBe(false)
    expect(actions.browserNotification).toBe(true)
  })

  it('aborted turns never notify — the user stopped it themselves', () => {
    const actions = attentionForDone(
      { chatId: 'c1', agentId: 'main', aborted: true },
      { visibleChatId: '', settings: SETTINGS },
    )
    expect(actions).toEqual({ toast: false, sound: false, browserNotification: false, markSeen: false })
  })
})

describe('attention helpers', () => {
  it('visibleChatIdFromLocation parses the /chat/$chatId path (PR2 migration)', () => {
    expect(visibleChatIdFromLocation('/chat/c1')).toBe('c1')
    expect(visibleChatIdFromLocation('/chat/c1/')).toBe('c1')
    expect(visibleChatIdFromLocation('/chat/abc%20def')).toBe('abc def')
    // No conversation in view — list, draft, other pages, deeper paths:
    expect(visibleChatIdFromLocation('/chat')).toBe('')
    expect(visibleChatIdFromLocation('/chat/new')).toBe('')
    expect(visibleChatIdFromLocation('/tasks')).toBe('')
    expect(visibleChatIdFromLocation('/chat/c1/extra')).toBe('')
    // The retired ?chat= shape is dead by decision (no redirects):
    expect(visibleChatIdFromLocation('/chat')).toBe('')
  })

  it('badgeFor: unread count wins, working dot otherwise, null when idle', () => {
    expect(badgeFor(3, 1)).toEqual({ count: 3, tone: 'attention' })
    expect(badgeFor(0, 2)).toEqual({ tone: 'info' })
    expect(badgeFor(0, 0)).toBeNull()
  })

  it('withUnreadPrefix is idempotent and clears cleanly', () => {
    expect(withUnreadPrefix('Bakin', 2)).toBe('(2) Bakin')
    expect(withUnreadPrefix('(2) Bakin', 5)).toBe('(5) Bakin')
    expect(withUnreadPrefix('(5) Bakin', 0)).toBe('Bakin')
    expect(withUnreadPrefix('Bakin', 120)).toBe('(99+) Bakin')
  })
})

describe('ChatBadgeProvider', () => {
  const realFetch = globalThis.fetch
  let unreadCounts: number[] = []

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plugins/chat/chats')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              chats: unreadCounts.map((n, i) => ({
                id: `chat-${i}`,
                agentId: 'main',
                title: `Chat ${i}`,
                titleSource: 'fallback',
                pinned: false,
                createdAt: '',
                updatedAt: new Date().toISOString(),
                messageCount: 2,
                unreadCount: n,
                streaming: false,
              })),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('seeds the nav badge from unread counts and prefixes the tab title', async () => {
    unreadCounts = [2, 1]
    document.title = 'Bakin'
    render(<ChatBadgeProvider />)
    await waitFor(() => {
      expect(getNavBadge('chat')).toEqual({ count: 3, tone: 'attention' })
    })
    expect(document.title).toBe('(3) Bakin')
  })

  it('a reply while elsewhere raises a toast; the working dot shows while streaming', async () => {
    unreadCounts = []
    render(<ChatBadgeProvider />)
    await waitFor(() => expect(getNavBadge('chat')).toBeFalsy())

    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: 'c9', agentId: 'main', chunk: { type: 'text', content: 'x' } })
    })
    await waitFor(() => expect(getNavBadge('chat')).toEqual({ tone: 'info' }))

    unreadCounts = [1]
    act(() => {
      emitPluginEvent({ event: 'chat.done', chatId: 'c9', agentId: 'main', preview: 'All done!' })
    })
    await waitFor(() => {
      expect(useToastStore.getState().toasts.length).toBe(1)
    })
    await waitFor(() => expect(getNavBadge('chat')).toEqual({ count: 1, tone: 'attention' }))
  })
})
