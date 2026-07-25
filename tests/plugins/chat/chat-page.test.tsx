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
          return { chatId: CHAT_A, sent: true }
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

  it('stages an image locally before the chat exists and hands the Files to first send (#730)', async () => {
    const realCreateObjectURL = URL.createObjectURL
    URL.createObjectURL = (() => 'blob:draft-preview') as typeof URL.createObjectURL
    try {
      mockFetch({ capabilities: { imageInput: true } })
      const sends: Array<{ content: string; files: File[] }> = []
      const { container } = render(
        <DraftChatView
          agentId="main"
          onCreated={() => {}}
          createAndSend={async (_agentId, content, files) => {
            sends.push({ content, files: files ?? [] })
            return { chatId: CHAT_A, sent: true }
          }}
        />,
      )
      // Capability-gated affordance appears for an image-capable agent.
      await waitFor(() => {
        const attach = container.querySelector('[data-composer-attach]') as HTMLButtonElement | null
        expect(attach).not.toBeNull()
        expect(attach!.disabled).toBe(false)
      })
      const file = new File(['png-bytes'], 'first.png', { type: 'image/png' })
      const input = container.querySelector('input[type="file"]')!
      fireEvent.change(input, { target: { files: [file] } })
      // Local stage: instant thumbnail, no upload yet.
      await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:draft-preview'))
      expect(fetchCalls.some((c) => c.url.includes('/attachments'))).toBe(false)

      const ta = container.querySelector('textarea')!
      fireEvent.change(ta, { target: { value: 'look at this' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
      await waitFor(() => expect(sends).toHaveLength(1))
      expect(sends[0].content).toBe('look at this')
      expect(sends[0].files.map((f) => f.name)).toEqual(['first.png'])
      cleanup()
    } finally {
      URL.createObjectURL = realCreateObjectURL
    }
  })

  it('hides the attach affordance for a text-only agent', async () => {
    mockFetch({ capabilities: { imageInput: false } })
    const { container } = render(
      <DraftChatView agentId="texty" onCreated={() => {}} createAndSend={async () => ({ chatId: CHAT_A, sent: true })} />,
    )
    await settleReact()
    const attach = container.querySelector('[data-composer-attach]') as HTMLButtonElement | null
    // Affordance renders disabled with the honest reason (existing gating pattern).
    expect(attach).not.toBeNull()
    expect(attach!.disabled).toBe(true)
    cleanup()
  })
})

describe('createAndSend orchestration (#730)', () => {
  it('creates the chat, uploads each staged file, then sends with attachment refs — in that order', async () => {
    mockFetch({
      attachments: { attachment: { name: 'first.png', mimeType: 'image/png', path: '/srv/chat/attachments/x/first.png' } },
      messages: { accepted: true },
      chats: { chat: { id: CHAT_A, agentId: 'main' } },
    })
    const { createAndSend } = await import('../../../plugins/chat/components/chat-page')
    const file = new File(['png-bytes'], 'first.png', { type: 'image/png' })
    const res = await createAndSend('main', 'look at this', [file])
    expect(res).toEqual({ chatId: CHAT_A, sent: true })

    const urls = fetchCalls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)
    const createIdx = urls.findIndex((u) => u.startsWith('POST') && u.endsWith('/chats'))
    const uploadIdx = urls.findIndex((u) => u.includes(`/chats/${CHAT_A}/attachments`))
    const sendIdx = urls.findIndex((u) => u.includes(`/chats/${CHAT_A}/messages`))
    expect(createIdx).toBeGreaterThanOrEqual(0)
    expect(uploadIdx).toBeGreaterThan(createIdx)
    expect(sendIdx).toBeGreaterThan(uploadIdx)
    // The send body carries the uploaded refs.
    const sendCall = fetchCalls.find((c) => c.url.includes('/messages'))!
    const body = JSON.parse(String(sendCall.init?.body)) as { attachments?: Array<{ name: string }> }
    expect(body.attachments?.map((a) => a.name)).toEqual(['first.png'])
  })

  it('a failed first-message POST preserves the text as the new chat\'s composer draft (never silent loss)', async () => {
    fetchCalls = []
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchCalls.push({ url, init })
      if (url.includes('/messages')) {
        return Promise.resolve(new Response('{"error":"boom"}', { status: 500 }))
      }
      if (url.endsWith('/chats') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ chat: { id: CHAT_A, agentId: 'main' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
    const { createAndSend } = await import('../../../plugins/chat/components/chat-page')
    const res = await createAndSend('main', 'precious words', [])
    expect(res).toEqual({ chatId: CHAT_A, sent: false })
    // The typed text became the created chat's persisted composer draft.
    expect(localStorage.getItem(`bakin-composer-draft:chat:${CHAT_A}`)).toBe('precious words')
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
