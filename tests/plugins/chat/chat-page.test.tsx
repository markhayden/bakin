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

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
  it('groups pinned chats first, shows unread pills and a working spinner', async () => {
    let __view0!: ReturnType<typeof render>
    await act(async () => {
      __view0 = render(
        <ChatRail
          {...railProps}
          chats={[
            summary({ id: CHAT_A, title: 'Working chat', unreadCount: 3 }),
            summary({ id: CHAT_B, title: 'Pinned chat', pinned: true }),
          ]}
          streamingIds={new Set([CHAT_A])}
        />,
      )
    })
    const { container } = __view0
    const labels = Array.from(container.querySelectorAll('.uppercase')).map((el) => el.textContent)
    expect(labels[0]).toBe('Pinned')
    expect(container.querySelector('[data-chat-unread]')).toBeNull() // streaming spinner wins over the pill
    expect(container.querySelector('[data-chat-working]')).not.toBeNull()
    // Rows are kit ListRow + ghost Button (refit T6.5): hover state comes
    // from the Button's own surface token, never accent-on-accent.
    const row = container.querySelector(`[data-chat-row="${CHAT_B}"]`)
    expect(row?.querySelector('button')?.className).toContain('hover:bg-bakin-surface-default')
  })

  it('unread pill renders when idle; selected row uses the muted-gray token', async () => {
    let __view1!: ReturnType<typeof render>
    await act(async () => {
      __view1 = render(
        <ChatRail
          {...railProps}
          selectedId={CHAT_A}
          chats={[summary({ unreadCount: 2 })]}
          streamingIds={new Set()}
        />,
      )
    })
    const { container } = __view1
    expect(container.querySelector('[data-chat-unread]')?.textContent).toBe('2')
    const row = container.querySelector(`[data-chat-row="${CHAT_A}"]`)
    // selection reads as the subtle surface token, never the theme accent (pink)
    expect(row?.querySelector('button')?.className).toContain('bg-bakin-surface-default')
    expect(row?.className).not.toContain('bg-accent')
  })

  it('collapsed rail renders only the expand affordance', async () => {
    let __view2!: ReturnType<typeof render>
    await act(async () => {
      __view2 = render(
        <ChatRail {...railProps} chats={[summary()]} streamingIds={new Set()} collapsed />,
      )
    })
    const { container } = __view2
    expect(container.querySelector('[data-chat-row]')).toBeNull()
    expect(container.querySelector('[aria-label="Expand chat list"]')).not.toBeNull()
  })

  it('loading shows skeleton rows, never a blank rail', async () => {
    let __view3!: ReturnType<typeof render>
    await act(async () => {
      __view3 = render(
        <ChatRail {...railProps} chats={[]} streamingIds={new Set()} loading />,
      )
    })
    const { container } = __view3
    expect(container.querySelector('[data-chat-rail-skeleton]')).not.toBeNull()
    cleanup()
  })
})

describe('Launcher', () => {
  it('shows the start heading and recent conversations', async () => {
    let __view4!: ReturnType<typeof render>
    await act(async () => {
      __view4 = render(
        <Launcher
          chats={[summary(), summary({ id: CHAT_B, title: 'Ops standup' })]}
          loading={false}
          onStartChat={() => {}}
          onOpenChat={() => {}}
        />,
      )
    })
    const { container } = __view4
    expect(container.textContent).toContain('Start a chat')
    expect(container.textContent).toContain('Recent')
    expect(container.textContent).toContain('Ops standup')
    expect(container.textContent).toContain('Found the post.')
  })

  it('loading renders skeletons', async () => {
    let __view5!: ReturnType<typeof render>
    await act(async () => {
      __view5 = render(<Launcher chats={[]} loading onStartChat={() => {}} onOpenChat={() => {}} />)
    })
    const { container } = __view5
    expect(container.querySelector('[data-chat-launcher-skeleton]')).not.toBeNull()
    cleanup()
  })
})

describe('DraftChatView', () => {
  it('creates the chat on first send and reports the new id', async () => {
    const created: string[] = []
    const calls: Array<[string, string]> = []
    let __view6!: ReturnType<typeof render>
    await act(async () => {
      __view6 = render(
        <DraftChatView
          agentId="main"
          onCreated={(id) => created.push(id)}
          createAndSend={async (agentId, content) => {
            calls.push([agentId, content])
            return { chatId: CHAT_A, sent: true }
          }}
        />,
      )
    })
    const { container } = __view6
    expect(container.textContent).toContain('Chat with main')
    const ta = container.querySelector('textarea')!
    await act(async () => { fireEvent.change(ta, { target: { value: 'first message' } }) })
    await act(async () => { fireEvent.keyDown(ta, { key: 'Enter' }) })
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
      let __view7!: ReturnType<typeof render>
      await act(async () => {
        __view7 = render(
          <DraftChatView
            agentId="main"
            onCreated={() => {}}
            createAndSend={async (_agentId, content, files) => {
              sends.push({ content, files: files ?? [] })
              return { chatId: CHAT_A, sent: true }
            }}
          />,
        )
      })
      const { container } = __view7
      // Capability-gated affordance appears for an image-capable agent.
      await waitFor(() => {
        const attach = container.querySelector('[data-composer-attach]') as HTMLButtonElement | null
        expect(attach).not.toBeNull()
        expect(attach!.disabled).toBe(false)
      })
      const file = new File(['png-bytes'], 'first.png', { type: 'image/png' })
      const input = container.querySelector('input[type="file"]')!
      await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
      // Local stage: instant thumbnail, no upload yet.
      await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:draft-preview'))
      expect(fetchCalls.some((c) => c.url.includes('/attachments'))).toBe(false)

      const ta = container.querySelector('textarea')!
      await act(async () => { fireEvent.change(ta, { target: { value: 'look at this' } }) })
      await act(async () => { fireEvent.keyDown(ta, { key: 'Enter' }) })
      await waitFor(() => expect(sends).toHaveLength(1))
      expect(sends[0].content).toBe('look at this')
      expect(sends[0].files.map((f) => f.name)).toEqual(['first.png'])
      cleanup()
    } finally {
      URL.createObjectURL = realCreateObjectURL
    }
  })

  it('text-only agent: attach stays ENABLED for PDFs, images filtered via accept (#742)', async () => {
    mockFetch({ capabilities: { imageInput: false } })
    let __view8!: ReturnType<typeof render>
    await act(async () => {
      __view8 = render(
        <DraftChatView agentId="texty" onCreated={() => {}} createAndSend={async () => ({ chatId: CHAT_A, sent: true })} />,
      )
    })
    const { container } = __view8
    await settleReact()
    const attach = container.querySelector('[data-composer-attach]') as HTMLButtonElement | null
    // PDFs ride the file lane (tools read them) — only image acceptance is
    // gated on the model's eyes, surfaced honestly on the affordance title.
    expect(attach).not.toBeNull()
    expect(attach!.disabled).toBe(false)
    expect(attach!.getAttribute('title')).toContain("can't see images")
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('application/pdf')
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
    let __view9!: ReturnType<typeof render>
    await act(async () => {
      __view9 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view9
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

  it('renders per-turn usage footers and the Σ header total (#733)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [
          { kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'how do burn buckets work?' },
          { kind: 'assistant', ts: '2026-07-11T10:00:05.000Z', turnId: 't1', content: 'Like this.' },
          { kind: 'assistant', ts: '2026-07-11T10:01:00.000Z', turnId: 't2', content: 'Subscription reply.' },
        ],
        usage: {
          t1: { inputTokens: 14_200, outputTokens: 890, costUsd: 0.03, model: 'anthropic/claude-sonnet-5', lane: 'metered' },
          t2: { inputTokens: 22_100, outputTokens: 1_200, model: 'pi/pi-local', lane: 'subscription' },
        },
        usageTotals: { turns: 2, inputTokens: 36_300, outputTokens: 2_090, totalTokens: 38_390, costUsd: 0.03 },
      },
    })
    let __view10!: ReturnType<typeof render>
    await act(async () => {
      __view10 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view10
    await waitFor(() => {
      expect(container.querySelectorAll('[data-conv-usage]').length).toBe(2)
    })
    const footers = [...container.querySelectorAll('[data-conv-usage]')].map((el) => el.textContent)
    // Billed-first cost explainer (#737): in+out fallback bill, no-tool
    // turns collapse to one line.
    expect(footers[0]).toContain('15.1k billed')
    expect(footers[0]).toContain('$0.03')
    expect(footers[0]).toContain('claude-sonnet-5')
    // Subscription lane: tokens only.
    expect(footers[1]).toContain('23.3k billed')
    expect(footers[1]).not.toContain('$')
    // The totals chip in the header — plain words, no Σ sigil (review:
    // "nobody will understand that").
    const chip = container.querySelector('[data-chat-usage-totals]')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toContain('38.4k tokens')
    expect(chip!.textContent).not.toContain('Σ')
    expect(chip!.textContent).toContain('$0.03')
    cleanup()
  })

  it('while streaming, the live output estimate rides the streaming TURN (far right of the shimmer) — the header chip stays recorded-only', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary({ streaming: true }),
        messages: [{ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'long job' }],
        usage: { t0: { inputTokens: 10_000, outputTokens: 500, costUsd: 0.02, lane: 'metered' } },
        usageTotals: { turns: 1, totalTokens: 10_500, costUsd: 0.02 },
        // 400 chars streamed so far → ~100 tokens at chars÷4.
        streamingText: 'x'.repeat(400),
      },
    })
    let __view11!: ReturnType<typeof render>
    await act(async () => {
      __view11 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view11
    await waitFor(() => {
      const live = container.querySelector('[data-conv-usage-live]')
      expect(live).not.toBeNull()
      expect(live!.textContent).toContain('~100 out…')
    })
    // The estimate sits on the shimmer row of the streaming turn.
    const shimmerRow = container.querySelector('[data-conv-usage-live]')!.parentElement!
    expect(shimmerRow.textContent).toContain('thinking')
    // The header chip stays recorded-only — no estimate blended in.
    const chip = container.querySelector('[data-chat-usage-totals]')!
    expect(chip.textContent).toContain('10.5k tokens')
    expect(chip.textContent).not.toContain('~')
    cleanup()
  })

  it('renders the compaction bar in the header from GET contextStats (#737)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [{ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'hi' }],
        usage: {},
        contextStats: { tokens: 45_300, contextWindow: 272_000, compactionThreshold: 255_616, model: 'gpt-5.5' },
      },
    })
    let __view12!: ReturnType<typeof render>
    await act(async () => {
      __view12 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view12
    await waitFor(() => {
      const meter = container.querySelector('[data-context-meter]')
      expect(meter).not.toBeNull()
      expect(meter!.textContent).toContain('45.3k / 272k (16%)')
    })
    // The threshold tick rides the kit Progress marker slot.
    expect(container.querySelector('[data-slot="progress-marker"]')).not.toBeNull()
    cleanup()
  })

  it('truthy stats that render NOTHING (stale store, no compaction) leave no dangling separator', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [{ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'hi' }],
        usage: { t1: { totalTokens: 10_000, costUsd: 0.02, lane: 'metered' } },
        usageTotals: { turns: 1, totalTokens: 10_000, costUsd: 0.02 },
        // The stale-store shape: truthy object, meter draws nothing.
        contextStats: { tokens: null, contextWindow: 272_000, compactionThreshold: null },
      },
    })
    let __view13!: ReturnType<typeof render>
    await act(async () => {
      __view13 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view13
    await waitFor(() => {
      expect(container.querySelector('[data-chat-usage-totals]')).not.toBeNull()
    })
    expect(container.querySelector('[data-context-meter]')).toBeNull()
    const chip = container.querySelector('[data-chat-usage-totals]')!
    expect(chip.textContent!.trimStart().startsWith('·')).toBe(false)
    cleanup()
  })

  it('a post-compaction gap renders the honest "context —" bar (#737 e2e)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [{ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'hi' }],
        usage: {},
        contextStats: {
          tokens: null,
          contextWindow: 272_000,
          compactionThreshold: null,
          lastCompaction: { at: new Date(Date.now() - 120_000).toISOString(), tokensBefore: 253_000 },
        },
      },
    })
    let __view14!: ReturnType<typeof render>
    await act(async () => {
      __view14 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view14
    await waitFor(() => {
      const meter = container.querySelector('[data-context-meter]')
      expect(meter).not.toBeNull()
      expect(meter!.textContent).toContain('context —')
      expect(meter!.textContent!.toLowerCase()).toContain('compacted')
    })
    cleanup()
  })

  it('the header carries agent identity only as the avatar tooltip; the working ticker is gone', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary({ streaming: true }),
        messages: [],
        usage: {},
      },
    })
    let __view15!: ReturnType<typeof render>
    await act(async () => {
      __view15 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view15
    await waitFor(() => expect(container.querySelector('[data-chat-title]')).not.toBeNull())
    const avatarWrap = container.querySelector('span[title="main"]')
    expect(avatarWrap).not.toBeNull()
    const header = container.querySelector('[data-chat-header]')
    // Refit T6.5: the header rides flex rows, not a hand-rolled grid template.
    expect(header?.className).toContain('flex')
    expect(container.querySelector('[data-chat-header-title]')?.className).toContain('min-w-0')
    expect(container.querySelector('[data-chat-header-meta]')).toBeNull()
    // The name never renders as visible header text …
    expect(header?.textContent ?? '').not.toContain('main')
    // … and the removed working ticker stays removed.
    expect(container.querySelector('[data-chat-header-working]')).toBeNull()
    cleanup()
  })

  it('no contextStats from the server → no bar (capability absent = honest absence)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: { chat: summary(), messages: [], usage: {} },
    })
    let __view16!: ReturnType<typeof render>
    await act(async () => {
      __view16 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view16
    await settleReact()
    expect(container.querySelector('[data-context-meter]')).toBeNull()
    cleanup()
  })

  it('no recorded usage → no footers, no header chip (absence, never zeros)', async () => {
    mockFetch({
      [`/chats/${CHAT_A}/seen`]: {},
      capabilities: { imageInput: false },
      [`/chats/${CHAT_A}`]: {
        chat: summary(),
        messages: [
          { kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'hi' },
          { kind: 'assistant', ts: '2026-07-11T10:00:05.000Z', turnId: 't1', content: 'hello' },
        ],
        usage: {},
      },
    })
    let __view17!: ReturnType<typeof render>
    await act(async () => {
      __view17 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view17
    await waitFor(() => expect(container.textContent).toContain('hello'))
    expect(container.querySelector('[data-conv-usage]')).toBeNull()
    expect(container.querySelector('[data-chat-usage-totals]')).toBeNull()
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
    let __view18!: ReturnType<typeof render>
    await act(async () => {
      __view18 = render(<ChatView chatId={CHAT_A} onChanged={() => {}} />)
    })
    const { container } = __view18
    await waitFor(() => {
      expect(container.querySelector('[data-queued-list]')?.textContent).toContain('queued correction')
    })
    // Streaming + empty composer → the morphing button shows Stop.
    expect(container.querySelector('[data-composer-stop]')).not.toBeNull()

    await act(async () => { fireEvent.click(container.querySelector('[data-queued-remove]')!) })
    await waitFor(() => {
      expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('queued correction')
    })
    await settleReact()
    expect(fetchCalls.some((c) => c.url.includes('/queued/q1') && c.init?.method === 'DELETE')).toBe(true)
    cleanup()
  })
})
