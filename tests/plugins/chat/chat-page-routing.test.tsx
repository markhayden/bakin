// @vitest-environment jsdom
/**
 * ChatPage path-based identity (routing overhaul PR2, spec D2).
 *
 * The page mode comes from props threaded by the host routes — chatId
 * (/chat/$chatId), draft (/chat/new) — never from ?chat=/?draft= query
 * state. These tests render the full ChatPage against the router shim
 * with a spy navigate and pin: mode selection per prop, the draft agent
 * riding ?agent= on /chat/new, and rail selection pushing /chat/<id>.
 */
import { describe, expect, it, mock, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-chat-page-routing-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, chat: join(testDir, 'chat'), db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

// Router shim (house convention) + a spy navigate so push targets are
// assertable. useLocation reads happy-dom's real window.location.
const navigations: unknown[] = []
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useNavigate: () => (opts: unknown) => navigations.push(opts),
}))

import { fireEvent, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'

import { ChatPage } from '../../../plugins/chat/components/chat-page'

const CHAT_A = '11111111-1111-1111-1111-111111111111'

const CHAT_SUMMARY = {
  id: CHAT_A,
  agentId: 'main',
  title: 'Reddit research',
  titleSource: 'fallback',
  pinned: false,
  createdAt: '2026-07-11T09:00:00.000Z',
  updatedAt: new Date().toISOString(),
  messageCount: 1,
  unreadCount: 0,
  lastMessagePreview: 'hi',
}

// happy-dom: history.replaceState doesn't sync window.location — use setURL.
function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

const realFetch = globalThis.fetch
let fetched: string[] = []

function mockFetch() {
  fetched = []
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input)
    fetched.push(url)
    const body = url.includes(`/chats/${CHAT_A}`)
      ? { chat: CHAT_SUMMARY, messages: [] }
      : url.includes('/chats')
        ? { chats: [CHAT_SUMMARY] }
        : {}
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  navigations.length = 0
})

describe('ChatPage path-based identity', () => {
  it('chatId prop renders the conversation (fetches that chat)', async () => {
    mockFetch()
    setURL(`http://localhost:3737/chat/${CHAT_A}`)
    const { container } = render(<ChatPage chatId={CHAT_A} />)
    await waitFor(() => {
      expect(fetched.some((u) => u.includes(`/chats/${CHAT_A}`))).toBe(true)
    })
    expect(container.querySelector('[data-chat-pane]')).not.toBeNull()
  })

  it('draft prop + ?agent= renders the draft composer for that agent', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat/new?agent=main')
    const { container } = render(<ChatPage draft />)
    await waitFor(() => {
      expect(container.textContent).toContain('Chat with main')
    })
    // The draft agent must NOT filter the rail: the chats list is fetched
    // without an agent filter.
    expect(fetched.some((u) => u.includes('chats?agent='))).toBe(false)
  })

  it('no props renders the launcher (list page)', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat')
    const { container } = render(<ChatPage />)
    await waitFor(() => {
      expect(container.textContent).toContain('Start a chat')
    })
    expect(container.querySelector('[data-archetype="conversation"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="page-header"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="search-input-control"]')).not.toBeNull()
    expect(container.querySelector('[data-chat-workspace]')).not.toBeNull()
  })

  it('selecting a rail chat pushes /chat/<id>', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat')
    const { container } = render(<ChatPage />)
    await waitFor(() => {
      expect(container.querySelector(`[data-chat-row="${CHAT_A}"]`)).not.toBeNull()
    })
    fireEvent.click(container.querySelector(`[data-chat-row="${CHAT_A}"]`)!)
    const pushed = navigations.find(
      (n) => (n as { to?: string }).to === `/chat/${CHAT_A}`,
    )
    expect(pushed).toBeDefined()
  })

  it('active conversations expose a mobile-safe route back to the chat list', async () => {
    mockFetch()
    setURL(`http://localhost:3737/chat/${CHAT_A}`)
    const { container } = render(<ChatPage chatId={CHAT_A} />)
    await waitFor(() => {
      expect(container.querySelector('[data-chat-mobile-back]')).not.toBeNull()
    })
    fireEvent.click(container.querySelector('[data-chat-mobile-back]')!)
    expect(navigations.some((value) => (value as { to?: string }).to === '/chat')).toBe(true)
  })
})
