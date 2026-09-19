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

import { act, fireEvent, render, waitFor } from '@testing-library/react'
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
    let __view0!: ReturnType<typeof render>
    await act(async () => {
      __view0 = render(<ChatPage chatId={CHAT_A} />)
    })
    const { container } = __view0
    await waitFor(() => {
      expect(fetched.some((u) => u.includes(`/chats/${CHAT_A}`))).toBe(true)
    })
    expect(container.querySelector('[data-chat-pane]')).not.toBeNull()
  })

  it('draft prop + ?agent= renders the draft composer for that agent', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat/new?agent=main')
    let __view1!: ReturnType<typeof render>
    await act(async () => {
      __view1 = render(<ChatPage draft />)
    })
    const { container } = __view1
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
    let __view2!: ReturnType<typeof render>
    await act(async () => {
      __view2 = render(<ChatPage />)
    })
    const { container } = __view2
    await waitFor(() => {
      expect(container.textContent).toContain('Start a chat')
    })
    expect(container.querySelector('[data-archetype="workspace"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="page-header"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="search-input-control"]')).not.toBeNull()
    expect(container.querySelector('[data-chat-workspace]')).not.toBeNull()
  })

  it('selecting a rail chat pushes /chat/<id>', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat')
    let __view3!: ReturnType<typeof render>
    await act(async () => {
      __view3 = render(<ChatPage />)
    })
    const { container } = __view3
    await waitFor(() => {
      expect(container.querySelector(`[data-chat-row="${CHAT_A}"]`)).not.toBeNull()
    })
    // The row is a kit ListRow whose full-width ghost Button owns the click (refit T6.5).
    await act(async () => { fireEvent.click(container.querySelector(`[data-chat-row="${CHAT_A}"] button`)!) })
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

describe('ChatPage ?agent= list filter', () => {
  it('renders the filtered list page without an update loop', async () => {
    // useChats returned a fresh filtered array every render whenever ?agent=
    // was set, and the streaming-indicator effect keyed on it set state with a
    // new Set each time — "Maximum update depth exceeded" on /chat?agent=<id>.
    mockFetch()
    setURL('http://localhost:3737/chat?agent=main')
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<ChatPage />) })
    await waitFor(() => expect(view.container.querySelector(`[data-chat-row="${CHAT_A}"]`)).not.toBeNull())
    expect(view.container.textContent).toContain('1 shown')
  })
})

describe('ChatPage ?q= rail search', () => {
  // The header SearchInput is an accessible searchbox named by its label.
  const searchbox = (container: HTMLElement) =>
    container.querySelector('input[type="search"][aria-label="Chat search"]') as HTMLInputElement | null

  it('cold-loads the rail search from ?q= and filters the rail without navigating', async () => {
    mockFetch()
    navigations.length = 0
    setURL('http://localhost:3737/chat?q=reddit')
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<ChatPage />) })
    await waitFor(() => expect(view.container.querySelector(`[data-chat-row="${CHAT_A}"]`)).not.toBeNull())
    expect(searchbox(view.container)?.value).toBe('reddit')
    expect(navigations).toHaveLength(0)
  })

  it('a non-matching ?q= hides the rail row', async () => {
    mockFetch()
    setURL('http://localhost:3737/chat?q=zzz-no-match')
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<ChatPage />) })
    await waitFor(() => expect(searchbox(view.container)).not.toBeNull())
    expect(searchbox(view.container)!.value).toBe('zzz-no-match')
    await waitFor(() => expect(view.container.textContent).toContain('0 shown'))
    expect(view.container.querySelector(`[data-chat-row="${CHAT_A}"]`)).toBeNull()
  })

  it('typing writes ?q= in one replace navigation', async () => {
    mockFetch()
    navigations.length = 0
    setURL('http://localhost:3737/chat')
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<ChatPage />) })
    await waitFor(() => expect(searchbox(view.container)).not.toBeNull())
    await act(async () => { fireEvent.change(searchbox(view.container)!, { target: { value: 'red' } }) })
    await waitFor(() => expect(navigations.length).toBeGreaterThan(0))
    const last = navigations[navigations.length - 1] as { to: string; search: Record<string, string>; replace?: boolean }
    expect(last).toMatchObject({ to: '/chat', search: { q: 'red' }, replace: true })
  })

  it('selecting a rail chat keeps ?agent= and ?q=', async () => {
    mockFetch()
    navigations.length = 0
    setURL('http://localhost:3737/chat?agent=main&q=reddit')
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<ChatPage />) })
    await waitFor(() => expect(view.container.querySelector(`[data-chat-row="${CHAT_A}"]`)).not.toBeNull())
    await act(async () => { fireEvent.click(view.container.querySelector(`[data-chat-row="${CHAT_A}"] button`)!) })
    const pushed = navigations.find((n) => (n as { to?: string }).to === `/chat/${CHAT_A}`) as { search: Record<string, string> } | undefined
    expect(pushed).toBeDefined()
    expect(pushed!.search).toEqual({ agent: 'main', q: 'reddit' })
  })
})
