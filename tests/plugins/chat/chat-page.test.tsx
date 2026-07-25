// @vitest-environment jsdom
/**
 * Chat page components (T4.2) — rail grouping + unread pills + working
 * spinner, launcher (agent cards + recents + skeletons), draft mode
 * (create on first send), and the kit-based ChatView (transcript render,
 * seen on mount, abort wiring). The ChatPage shell itself needs the
 * router; these test its parts directly.
 */
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-chat-page-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, chat: join(testDir, 'chat'), db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'

import { ChatRail } from '../../../plugins/chat/components/chat-rail'
import { Launcher } from '../../../plugins/chat/components/launcher'
import { ChatView, DraftChatView } from '../../../plugins/chat/components/chat-view'
import type { ChatSummaryDto } from '../../../plugins/chat/components/use-chat-data'

const CHAT_A = '11111111-1111-1111-1111-111111111111'
const CHAT_B = '22222222-2222-2222-2222-222222222222'

const summary = (over: Partial<ChatSummaryDto> = {}): ChatSummaryDto => ({
  id: CHAT_A,
  agentId: 'main',
  title: 'Reddit research',
  titleSource: 'fallback',
  pinned: false,
  createdAt: '2026-07-11T09:00:00.000Z',
  updatedAt: new Date().toISOString(),
  messageCount: 4,
  unreadCount: 0,
  lastMessagePreview: 'Found the post.',
  ...over,
})

type FetchCall = { url: string; init?: RequestInit }
let fetchCalls: FetchCall[] = []
const realFetch = globalThis.fetch

function mockFetch(routes: Record<string, unknown>) {
  fetchCalls = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.includes(prefix)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

beforeEach(() => {
  localStorage.clear()
})

const railProps = {
  loading: false,
  selectedId: '',
  agentIds: ['main', 'pixel'],
  agentFilter: '',
  collapsed: false,
  onCollapse: () => {},
  onSelect: () => {},
  onAgentFilter: () => {},
  onChanged: () => {},
}

describe('ChatRail', () => {
  it('groups pinned chats first, shows unread pills and a working spinner', () => {
    const { container } = render(
      <ChatRail
        {...railProps}
        chats={[
          summary({ id: CHAT_A, title: 'Working chat', unreadCount: 3 }),
          summary({ id: CHAT_B, title: 'Pinned chat', pinned: true }),
        ]}
        streamingIds={new Set([CHAT_A])}
      />,
    )
    const labels = Array.from(container.querySelectorAll('.uppercase')).map((el) => el.textContent)
    expect(labels[0]).toBe('Pinned')
    expect(container.querySelector('[data-chat-unread]')).toBeNull() // streaming spinner wins over the pill
    expect(container.querySelector('[data-chat-working]')).not.toBeNull()
    // selected-state contrast comes from paired tokens, never accent-on-accent
    const row = container.querySelector(`[data-chat-row="${CHAT_B}"]`)
    expect(row?.className).toContain('hover:bg-foreground/5')
  })

  it('unread pill renders when idle; selected row uses the muted-gray token', () => {
    const { container } = render(
      <ChatRail
        {...railProps}
        selectedId={CHAT_A}
        chats={[summary({ unreadCount: 2 })]}
        streamingIds={new Set()}
      />,
    )
    expect(container.querySelector('[data-chat-unread]')?.textContent).toBe('2')
    const row = container.querySelector(`[data-chat-row="${CHAT_A}"]`)
    expect(row?.className).toContain('bg-foreground/10')
    // never the theme accent (pink) — selection reads as a subtle gray
    expect(row?.className).not.toContain('bg-accent')
  })

  it('collapsed rail renders only the expand affordance', () => {
    const { container } = render(
      <ChatRail {...railProps} chats={[summary()]} streamingIds={new Set()} collapsed />,
    )
    expect(container.querySelector('[data-chat-row]')).toBeNull()
    expect(container.querySelector('[aria-label="Expand chat list"]')).not.toBeNull()
  })

  it('loading shows skeleton rows, never a blank rail', () => {
    const { container } = render(
      <ChatRail {...railProps} chats={[]} streamingIds={new Set()} loading />,
    )
    expect(container.querySelector('[data-chat-rail-skeleton]')).not.toBeNull()
    cleanup()
  })
})

describe('Launcher', () => {
  it('shows the start heading and recent conversations', () => {
    const { container } = render(
      <Launcher
        chats={[summary(), summary({ id: CHAT_B, title: 'Ops standup' })]}
        loading={false}
        onStartChat={() => {}}
        onOpenChat={() => {}}
      />,
    )
    expect(container.textContent).toContain('Start a chat')
    expect(container.textContent).toContain('Recent')
    expect(container.textContent).toContain('Ops standup')
    expect(container.textContent).toContain('Found the post.')
  })

  it('loading renders skeletons', () => {
    const { container } = render(<Launcher chats={[]} loading onStartChat={() => {}} onOpenChat={() => {}} />)
    expect(container.querySelector('[data-chat-launcher-skeleton]')).not.toBeNull()
    cleanup()
  })
})

describe('DraftChatView', () => {
  it('creates the chat on first send and reports the new id', async () => {
    const created: string[] = []
    const calls: Array<[string, string]> = []
    const { container } = render(
      <DraftChatView
        agentId="main"
        onCreated={(id) => created.push(id)}
        createAndSend={async (agentId, content) => {
          calls.push([agentId, content])
          return CHAT_A
        }}
      />,
    )
    expect(container.textContent).toContain('Chat with main')
    const ta = container.querySelector('textarea')!
    fireEvent.change(ta, { target: { value: 'first message' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() => expect(created).toEqual([CHAT_A]))
    expect(calls).toEqual([['main', 'first message']])
    cleanup()
  })
})

describe('ChatView', () => {
  it('renders the v2 transcript through the kit and marks the chat seen on mount', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [
          { kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'find the post' },
          { kind: 'tool', ts: '2026-07-11T10:00:01.000Z', turnId: 't1', callId: 'c1', toolName: 'web_search', status: 'completed', summary: 'site:reddit.com' },
          { kind: 'assistant', ts: '2026-07-11T10:00:02.000Z', turnId: 't1', content: 'Found the **post**.' },
        ],
      },
    })
    const { container } = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    await waitFor(() => {
      expect(container.textContent).toContain('find the post')
    })
    // agent turn renders with the collapsed activity header + markdown text
    expect(container.textContent).toContain('Searched the web')
    expect(container.querySelector('strong')?.textContent).toBe('post')
    // header shows the editable title + pin control
    expect(container.querySelector('[data-chat-title]')?.textContent).toContain('Reddit research')
    expect(container.querySelector('[aria-label="Pin chat"]')).not.toBeNull()
    // the composer is present and NOT disabled
    expect(container.querySelector('textarea')?.disabled).toBe(false)
    // seen fired on mount
    await settleReact()
    expect(fetchCalls.some((c) => c.url.includes(`/chats/${CHAT_A}/seen`) && c.init?.method === 'POST')).toBe(true)
    cleanup()
  })

  it('renders the queued strip while streaming; remove restores the text into the empty composer (#729)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/queued/q1`]: { removed: true },
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary({ streaming: true }),
        messages: [{ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'long job' }],
        queued: [{ id: 'q1', ts: '2026-07-25T00:00:00.000Z', content: 'queued correction' }],
      },
    })
    const { container } = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    await waitFor(() => {
      expect(container.querySelector('[data-queued-list]')?.textContent).toContain('queued correction')
    })
    // Streaming + empty composer → the morphing button shows Stop.
    expect(container.querySelector('[data-composer-stop]')).not.toBeNull()

    fireEvent.click(container.querySelector('[data-queued-remove]')!)
    await waitFor(() => {
      expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('queued correction')
    })
    await settleReact()
    expect(fetchCalls.some((c) => c.url.includes('/queued/q1') && c.init?.method === 'DELETE')).toBe(true)
    cleanup()
  })
})
