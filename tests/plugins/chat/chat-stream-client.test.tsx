// @vitest-environment jsdom
/**
 * useChatStream characterization (#703 C2a) — pins chat's CLIENT behavior
 * before the hook is reimplemented over the kit's useConversationThread.
 * These tests pass against the pre-swap hook and must pass, unchanged,
 * after the swap: chat's UX is frozen, and chat-page.test.tsx covers
 * almost none of the hook's semantics (one ChatView render test), so
 * this file IS the client-side regression gate.
 */
import { describe, expect, it, mock, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-chat-stream-client-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, chat: join(testDir, 'chat'), db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { act, renderHook, waitFor } from '@testing-library/react'
import '../../rtl-settle'

import { useChatStream, type ChatSummaryDto, type TranscriptRowDto } from '../../../plugins/chat/components/use-chat-data'
import { emitPluginEvent } from '@makinbakin/sdk/hooks'

const CHAT_A = 'aaaaaaaa-1111-1111-1111-111111111111'
const CHAT_B = 'bbbbbbbb-2222-2222-2222-222222222222'

const summary = (id: string, over: Partial<ChatSummaryDto> = {}): ChatSummaryDto => ({
  id,
  agentId: 'main',
  title: 'A chat',
  titleSource: 'fallback',
  pinned: false,
  createdAt: '2026-07-20T09:00:00.000Z',
  updatedAt: '2026-07-20T09:05:00.000Z',
  messageCount: 1,
  unreadCount: 0,
  ...over,
})

type FetchCall = { url: string; init?: RequestInit }

interface FetchStub {
  calls: FetchCall[]
  /** Route by substring; value = body object, a Response, or a deferred fn. */
  routes: Map<string, unknown>
}

const realFetch = globalThis.fetch

function stubFetch(): FetchStub {
  const stub: FetchStub = { calls: [], routes: new Map() }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    stub.calls.push({ url, init })
    const method = init?.method ?? 'GET'
    // Keys are `METHOD substring` — a bare substring matches any method.
    // Method-qualified routing matters: `/messages` POSTs also contain the
    // transcript GET route's `chats/<id>` substring.
    for (const [key, value] of stub.routes) {
      const space = key.indexOf(' ')
      const keyMethod = space > 0 ? key.slice(0, space) : null
      const prefix = space > 0 ? key.slice(space + 1) : key
      if (keyMethod && keyMethod !== method) continue
      if (!url.includes(prefix)) continue
      const resolved = typeof value === 'function' ? await (value as () => Promise<unknown>)() : value
      if (resolved instanceof Response) return resolved.clone()
      return new Response(JSON.stringify(resolved), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  return stub
}

afterEach(() => {
  globalThis.fetch = realFetch
})

function transcriptRoute(stub: FetchStub, chatId: string, chat: ChatSummaryDto, messages: TranscriptRowDto[]) {
  stub.routes.set(`GET chats/${chatId}`, { chat, messages })
}

const seenCalls = (stub: FetchStub) => stub.calls.filter((c) => c.url.includes('/seen') && c.init?.method === 'POST')
const messagePosts = (stub: FetchStub) =>
  stub.calls.filter((c) => c.url.includes('/messages') && c.init?.method === 'POST')

describe('useChatStream characterization (frozen chat client behavior)', () => {
  it('mount loads the transcript, maps attachment paths to served URLs, and marks the chat seen', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [
      {
        kind: 'user',
        ts: '2026-07-20T09:00:00Z',
        content: 'look at this',
        attachments: [{ name: 'pic.png', mimeType: 'image/png', path: '/somewhere/pic.png' }],
      },
      { kind: 'assistant', ts: '2026-07-20T09:00:10Z', content: 'nice pic' },
    ])
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.chat?.id).toBe(CHAT_A)
    const user = result.current.messages[0] as { attachments?: Array<{ url: string }> }
    expect(user.attachments?.[0].url).toBe(`/api/plugins/chat/chats/${CHAT_A}/attachments/pic.png`)
    await waitFor(() => expect(seenCalls(stub).length).toBeGreaterThan(0))
  })

  it('send appends the optimistic user row (with attachment URLs) synchronously, before the POST resolves', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    let resolvePost: () => void = () => {}
    stub.routes.set('POST /messages', () => new Promise<Response>((r) => {
      resolvePost = () => r(new Response('{}', { status: 202 }))
    }))
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})

    let sendPromise: Promise<void> = Promise.resolve()
    act(() => {
      sendPromise = result.current.send('here you go', [{ name: 'up.png', mimeType: 'image/png', path: '/tmp/up.png' }])
    })
    // Optimistic — POST still pending.
    const last = result.current.messages.at(-1) as { kind: string; content: string; attachments?: Array<{ url: string }> }
    expect(last).toMatchObject({ kind: 'user', content: 'here you go' })
    expect(last.attachments?.[0].url).toBe(`/api/plugins/chat/chats/${CHAT_A}/attachments/up.png`)
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([])
    await act(async () => {
      resolvePost()
      await sendPromise
    })
    expect(result.current.sendError).toBeNull()
    expect(messagePosts(stub)).toHaveLength(1)
  })

  it('failed send (409 busy) rolls back streaming state, surfaces the body error, and keeps the optimistic row', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    stub.routes.set('POST /messages', new Response(JSON.stringify({ error: 'agent is already replying' }), { status: 409 }))
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})
    await act(async () => { await result.current.send('too eager') })
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.sendError).toBe('agent is already replying')
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'too eager' })
  })

  it('chat.chunk events accumulate with same-format text coalescing; other chats are ignored', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'status', content: 'thinking' } })
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'Hel' } })
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'lo' } })
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_B, chunk: { type: 'text', content: 'wrong chat' } })
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'mono', format: 'code' } })
    })
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([
      { type: 'status', content: 'thinking' },
      { type: 'text', content: 'Hello' },
      { type: 'text', content: 'mono', format: 'code' },
    ])
  })

  it('chat.done settles: refetch + mark seen; chat.error settles the same way', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})
    const seenBefore = seenCalls(stub).length
    const transcriptFetchesBefore = stub.calls.filter((c) => c.url.includes(`chats/${CHAT_A}`)).length

    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'reply' } })
    })
    transcriptRoute(stub, CHAT_A, summary(CHAT_A, { messageCount: 2 }), [
      { kind: 'user', ts: '2026-07-20T09:00:00Z', content: 'q' },
      { kind: 'assistant', ts: '2026-07-20T09:00:10Z', content: 'reply' },
    ])
    await act(async () => {
      emitPluginEvent({ event: 'chat.done', chatId: CHAT_A, agentId: 'main', preview: 'reply' })
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toBeNull()
    expect(seenCalls(stub).length).toBeGreaterThan(seenBefore)
    expect(stub.calls.filter((c) => c.url.includes(`chats/${CHAT_A}`)).length).toBeGreaterThan(transcriptFetchesBefore)

    await act(async () => {
      emitPluginEvent({ event: 'chat.error', chatId: CHAT_A, agentId: 'main', message: 'boom' })
    })
    expect(result.current.streaming).toBe(false)
  })

  it('retry re-sends the newest user message INCLUDING its attachments', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    stub.routes.set('POST /messages', new Response(JSON.stringify({ error: 'nope' }), { status: 500 }))
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})
    const attachments = [{ name: 'doc.png', mimeType: 'image/png', path: '/tmp/doc.png' }]
    await act(async () => { await result.current.send('try this', attachments) })
    expect(result.current.sendError).toBe('nope')

    stub.routes.set('POST /messages', new Response('{}', { status: 202 }))
    await act(async () => { result.current.retry() })
    await waitFor(() => expect(messagePosts(stub)).toHaveLength(2))
    const retryBody = JSON.parse(String(messagePosts(stub)[1].init?.body)) as { content: string; attachments?: unknown[] }
    expect(retryBody.content).toBe('try this')
    expect(retryBody.attachments).toEqual(attachments)
  })

  it('switching chats resets live state, loads the new transcript, and drops events for the old chat', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [
      { kind: 'user', ts: '2026-07-20T09:00:00Z', content: 'in A' },
    ])
    transcriptRoute(stub, CHAT_B, summary(CHAT_B), [])
    const { result, rerender } = renderHook(({ id }: { id: string }) => useChatStream(id), {
      initialProps: { id: CHAT_A },
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'live' } })
    })
    expect(result.current.liveChunks).toHaveLength(1)

    rerender({ id: CHAT_B })
    await act(async () => {})
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages).toEqual([])
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'stale' } })
    })
    expect(result.current.liveChunks).toBeNull()
  })

  it("the server's streaming flag pre-lights the indicator and seeds the streamed-so-far text (#706 parity decision)", async () => {
    const stub = stubFetch()
    stub.routes.set(`GET chats/${CHAT_A}`, {
      chat: summary(CHAT_A, { streaming: true }),
      messages: [{ kind: 'user', ts: '2026-07-20T09:00:00Z', content: 'long job' }],
      streamingText: 'the reply so far',
    })
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'the reply so far' }])
    // The still-running turn's next chunk appends to the seeded text.
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: ' and more' } })
    })
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'the reply so far and more' }])
  })
})

describe('useAgentImageInput stale-while-revalidate (#731)', () => {
  const capsRoute = (stub: FetchStub, value: unknown) => {
    stub.routes.set('GET capabilities', value)
  }

  it('always revalidates on mount: a cached true downgrades to false after a model change — no session reset needed', async () => {
    const { useAgentImageInput } = await import('../../../plugins/chat/components/use-chat-data')
    const stub1 = stubFetch()
    capsRoute(stub1, { imageInput: true })
    const first = renderHook(() => useAgentImageInput('swr-agent'))
    await waitFor(() => expect(first.result.current).toBe(true))
    first.unmount()

    // The agent's model changed to text-only; a remount must catch it.
    const stub2 = stubFetch()
    capsRoute(stub2, { imageInput: false })
    const second = renderHook(() => useAgentImageInput('swr-agent'))
    // Seeds instantly from cache (no flicker)…
    expect(second.result.current).toBe(true)
    // …then the background probe corrects it.
    await waitFor(() => expect(second.result.current).toBe(false))
    second.unmount()
  })

  it('revalidation failure keeps the last-known value; first-ever failure stays conservative-false', async () => {
    const { useAgentImageInput } = await import('../../../plugins/chat/components/use-chat-data')
    const stub1 = stubFetch()
    capsRoute(stub1, { imageInput: true })
    const first = renderHook(() => useAgentImageInput('swr-flaky'))
    await waitFor(() => expect(first.result.current).toBe(true))
    first.unmount()

    const stub2 = stubFetch()
    stub2.routes.set('GET capabilities', new Response('{}', { status: 500 }))
    const second = renderHook(() => useAgentImageInput('swr-flaky'))
    await act(async () => {})
    expect(second.result.current).toBe(true) // network blip never yanks the affordance
    second.unmount()

    const third = renderHook(() => useAgentImageInput('swr-never-seen'))
    await act(async () => {})
    expect(third.result.current).toBe(false) // conservative-false preserved
    third.unmount()
  })

  it('concurrent mounts share one probe (rail + view double mount)', async () => {
    const { useAgentImageInput } = await import('../../../plugins/chat/components/use-chat-data')
    const stub = stubFetch()
    capsRoute(stub, { imageInput: true })
    const a = renderHook(() => useAgentImageInput('swr-dedup'))
    const b = renderHook(() => useAgentImageInput('swr-dedup'))
    await waitFor(() => expect(a.result.current).toBe(true))
    await waitFor(() => expect(b.result.current).toBe(true))
    expect(stub.calls.filter((c) => c.url.includes('capabilities'))).toHaveLength(1)
    a.unmount()
    b.unmount()
  })
})

describe('usage decoration staleness (#737 review)', () => {
  it('the settle refetch updates totals + bar (chat.done → fresh GET body applies)', async () => {
    const stub = stubFetch()
    let phase = 0
    stub.routes.set(`GET chats/${CHAT_A}`, () => {
      phase++
      return Promise.resolve(
        new Response(
          JSON.stringify({
            chat: summary(CHAT_A),
            messages: [],
            usage: {},
            usageTotals: { turns: phase, totalTokens: phase === 1 ? 10_000 : 25_000 },
            contextStats: { tokens: phase === 1 ? 40_000 : 66_000, contextWindow: 272_000, compactionThreshold: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await waitFor(() => expect(result.current.usageTotals?.totalTokens).toBe(10_000))
    // A turn settles → the kit refetches → the fresh decoration applies.
    act(() => { emitPluginEvent({ event: 'chat.done', chatId: CHAT_A }) })
    await waitFor(() => expect(result.current.usageTotals?.totalTokens).toBe(25_000))
    expect(result.current.contextStats?.tokens).toBe(66_000)
  })

  it('an earlier-started GET resolving late never regresses the bar/totals (last-started wins)', async () => {
    const stub = stubFetch()
    const bodies = [
      // First-started (stale) snapshot: pre-turn numbers.
      {
        chat: summary(CHAT_A),
        messages: [],
        usage: {},
        usageTotals: { turns: 1, totalTokens: 10_000 },
        contextStats: { tokens: 40_000, contextWindow: 272_000, compactionThreshold: null },
      },
      // Second-started (fresh) snapshot: post-turn numbers.
      {
        chat: summary(CHAT_A),
        messages: [],
        usage: {},
        usageTotals: { turns: 2, totalTokens: 25_000 },
        contextStats: { tokens: 66_000, contextWindow: 272_000, compactionThreshold: null },
      },
    ]
    const resolvers: Array<(r: Response) => void> = []
    let calls = 0
    stub.routes.set(`GET chats/${CHAT_A}`, () => {
      const idx = Math.min(calls++, 1)
      return new Promise<Response>((resolve) => {
        resolvers[idx] = (r) => resolve(r)
      })
    })
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {}) // mount load pending (call 0)
    act(() => { void result.current.refreshChat() }) // second load pending (call 1)
    await act(async () => {})

    const asResponse = (b: unknown) =>
      new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    // Fresh resolves FIRST…
    await act(async () => { resolvers[1]?.(asResponse(bodies[1])) })
    await waitFor(() => expect(result.current.contextStats?.tokens).toBe(66_000))
    // …then the stale one lands late. It must NOT move the bar backwards.
    await act(async () => { resolvers[0]?.(asResponse(bodies[0])) })
    await act(async () => {})
    expect(result.current.contextStats?.tokens).toBe(66_000)
    expect(result.current.usageTotals?.totalTokens).toBe(25_000)
  })
})

describe('queued follow-ups (#729 client)', () => {
  it('send while streaming posts and records a queued row — no busy error, live turn untouched', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [])
    stub.routes.set(
      'POST /messages',
      new Response(JSON.stringify({ accepted: true, queued: true, queueId: 'qx-1', queueLength: 1 }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'live so far' } })
    })
    await act(async () => { await result.current.send('queued correction') })
    expect(messagePosts(stub)).toHaveLength(1)
    expect(result.current.sendError).toBeNull()
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'live so far' }])
    expect(result.current.queued).toHaveLength(1)
    expect(result.current.queued[0]).toMatchObject({ id: 'qx-1', content: 'queued correction' })
  })

  it('"Try again" during a streaming turn queues instead of erroring (documented #729 semantics change)', async () => {
    const stub = stubFetch()
    transcriptRoute(stub, CHAT_A, summary(CHAT_A), [
      { kind: 'user', ts: '2026-07-25T00:00:00Z', content: 'the failed ask' },
      { kind: 'error', ts: '2026-07-25T00:00:01Z', message: 'boom' },
    ])
    stub.routes.set(
      'POST /messages',
      new Response(JSON.stringify({ accepted: true, queued: true, queueId: 'retry-q', queueLength: 1 }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    // A drained turn is already streaming when the user clicks Try again.
    act(() => {
      emitPluginEvent({ event: 'chat.chunk', chatId: CHAT_A, chunk: { type: 'text', content: 'draining' } })
    })
    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.queued).toHaveLength(1))
    expect(result.current.sendError).toBeNull()
    expect(result.current.queued[0]).toMatchObject({ id: 'retry-q', content: 'the failed ask' })
  })

  it('queued list hydrates from GET (attachment URLs mapped); removeQueued DELETEs and returns the item', async () => {
    const stub = stubFetch()
    stub.routes.set(`DELETE chats/${CHAT_A}/queued/q1`, { removed: true })
    stub.routes.set(`GET chats/${CHAT_A}`, {
      chat: summary(CHAT_A),
      messages: [],
      queued: [
        {
          id: 'q1',
          ts: '2026-07-25T00:00:00Z',
          content: 'stored follow-up',
          attachments: [{ name: 'pic.png', mimeType: 'image/png', path: '/srv/pic.png' }],
        },
      ],
    })
    const { result } = renderHook(() => useChatStream(CHAT_A))
    await waitFor(() => expect(result.current.queued).toHaveLength(1))
    expect(result.current.queued[0].attachments?.[0].url).toBe(
      `/api/plugins/chat/chats/${CHAT_A}/attachments/pic.png`,
    )

    let removed: unknown
    await act(async () => { removed = await result.current.removeQueued('q1') })
    expect(removed).toMatchObject({ id: 'q1', content: 'stored follow-up' })
    expect(result.current.queued).toHaveLength(0)
    expect(
      stub.calls.some((c) => c.url.includes(`/queued/q1`) && c.init?.method === 'DELETE'),
    ).toBe(true)
  })
})
