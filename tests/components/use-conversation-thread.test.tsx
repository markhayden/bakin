// @vitest-environment jsdom
/**
 * useConversationThread (#703) — the bus-driven client core shared by chat
 * and every embedded conversational surface. Pins the exact gaps the old
 * per-request path had: optimistic user echo on send, bus chunks
 * accumulating for the active thread only, settle-by-refetch, remount
 * rehydration with a server-seeded streaming flag, and chat's
 * failed-send semantics (state rollback, row stays, sendError set).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conv-thread-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, renderHook, waitFor } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { waitUntil } from '../helpers/wait'

import { useConversationThread, type ConversationMessage } from '@makinbakin/sdk/conversation'
import { emitPluginEvent } from '@makinbakin/sdk/hooks'

const EVENTS = { chunk: 'probe.chunk', done: 'probe.done', error: 'probe.error' }

interface Store {
  transcripts: Map<string, ConversationMessage[]>
  loads: string[]
  posts: Array<{ key: string; content: string }>
  postResult: { ok: boolean; status?: number; error?: string }
  streamingFlags: Map<string, boolean>
}

function makeStore(): Store {
  return {
    transcripts: new Map(),
    loads: [],
    posts: [],
    postResult: { ok: true },
    streamingFlags: new Map(),
  }
}

function hookFor(store: Store, threadKey: string, extras?: Record<string, unknown>) {
  return renderHook(
    ({ key }: { key: string }) =>
      useConversationThread({
        threadKey: key,
        events: EVENTS,
        keyOf: (p) => p.threadKey,
        load: async (k) => {
          store.loads.push(k)
          return {
            messages: store.transcripts.get(k) ?? [],
            ...(store.streamingFlags.get(k) ? { streaming: true } : {}),
            meta: { title: `meta:${k}` },
          }
        },
        post: async (k, content) => {
          store.posts.push({ key: k, content })
          return store.postResult
        },
        ...extras,
      }),
    { initialProps: { key: threadKey } },
  )
}

describe('useConversationThread', () => {
  it('loads the transcript + meta on mount; empty key loads nothing', async () => {
    const store = makeStore()
    store.transcripts.set('a', [{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'hi' }])
    const { result } = hookFor(store, 'a')
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.meta).toEqual({ title: 'meta:a' })

    const idle = hookFor(store, '')
    await act(async () => {})
    expect(store.loads).toEqual(['a'])
    idle.unmount()
  })

  it('send appends the optimistic user row synchronously and posts; the turn indicator lights up', async () => {
    const store = makeStore()
    let resolvePost: (v: Store['postResult']) => void = () => {}
    const gated = new Promise<Store['postResult']>((r) => { resolvePost = r })
    const { result } = renderHook(() =>
      useConversationThread({
        threadKey: 'a',
        events: EVENTS,
        keyOf: (p) => p.threadKey,
        load: async () => ({ messages: [] }),
        post: () => gated,
      }),
    )
    await act(async () => {})
    let sendPromise: Promise<void> = Promise.resolve()
    act(() => { sendPromise = result.current.send('hello world') })
    // Optimistic: visible BEFORE the POST resolves.
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'hello world' })
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([])
    await act(async () => {
      resolvePost({ ok: true })
      await sendPromise
    })
    expect(result.current.sendError).toBeNull()
  })

  it('failed post rolls back streaming state and sets sendError, but the optimistic row stays (chat semantics)', async () => {
    const store = makeStore()
    store.postResult = { ok: false, status: 409, error: 'agent is replying' }
    const { result } = hookFor(store, 'a')
    await act(async () => {})
    await act(async () => { await result.current.send('too fast') })
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.sendError).toBe('agent is replying')
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'too fast' })
  })

  it('bus chunks accumulate with same-format text coalescing; other threads are ignored', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a')
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'status', content: 'thinking' } })
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'Hel' } })
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'lo' } })
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'OTHER', chunk: { type: 'text', content: 'nope' } })
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'code', format: 'code' } })
    })
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([
      { type: 'status', content: 'thinking' },
      { type: 'text', content: 'Hello' },
      { type: 'text', content: 'code', format: 'code' },
    ])
  })

  it('done settles: refetch, live state cleared, onSettled receives the payload; error settles the same way', async () => {
    const store = makeStore()
    const settled: Array<Record<string, unknown>> = []
    const { result } = hookFor(store, 'a', { onSettled: (p: Record<string, unknown>) => settled.push(p) })
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'x' } })
    })
    store.transcripts.set('a', [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'q' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', content: 'x' },
    ])
    await act(async () => {
      emitPluginEvent({ event: EVENTS.done, threadKey: 'a', preview: 'x' })
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toBeNull()
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ preview: 'x' })

    await act(async () => {
      emitPluginEvent({ event: EVENTS.error, threadKey: 'a', message: 'boom' })
    })
    expect(settled).toHaveLength(2)
  })

  it('done keeps the live turn on screen until the settle refetch applies, then swaps both in one render', async () => {
    // 2026-11-11 live: the card flashed off and on at the end of every turn — live chunks
    // were cleared on `done`, one round trip before the durable rows arrived.
    const pending: Array<(messages: ConversationMessage[]) => void> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push(messages => resolve({ messages }))
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    // Settled, but the refetch is still in flight: the live turn is still there.
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'reply' }])
    expect(result.current.messages).toHaveLength(0)

    await act(async () => {
      pending[1]!([{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' }])
    })
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.messages).toHaveLength(1)
  })

  it('a settle refetch that throws still clears the live turn', async () => {
    const store = makeStore()
    let fail = false
    const { result } = await actRender(() => hookFor(store, 'a', {
      load: async (k: string) => {
        if (fail) throw new Error('offline')
        return { messages: store.transcripts.get(k) ?? [] }
      },
    }))
    await act(async () => {})
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    fail = true
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => result.current.liveChunks === null, { label: 'live cleared after failed settle load' })
    expect(result.current.streaming).toBe(false)
  })

  it('a chunk after done (a queued follow-up the server started) begins its own live turn, and the settled turn\'s refetch never clears it', async () => {
    // Review finding: with the live turn retained until the settle refetch applies, the next
    // turn's chunks appended to it, and the old turn's refetch then wiped both.
    const pending: Array<(messages: ConversationMessage[]) => void> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push(messages => resolve({ messages }))
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    // Turn B starts before A's refetch resolves.
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn B' } })
    })
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'turn B' }])
    // A's refetch lands: its rows apply, B's live turn survives.
    await act(async () => {
      pending[1]!([{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' }])
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'turn B' }])
    expect(result.current.streaming).toBe(true)
  })

  it('a send after done owns the live state: the previous turn\'s failed refetch does not clear it', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void; reject: (e: Error) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve, reject) => {
      pending.push({ resolve: messages => resolve({ messages }), reject })
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    await act(async () => { await result.current.send('follow-up') })
    expect(result.current.liveChunks).toEqual([])
    await act(async () => { pending[1]!.reject(new Error('offline')) })
    await act(async () => {})
    expect(result.current.liveChunks).toEqual([])
    expect(result.current.streaming).toBe(true)
  })

  it('a settle refetch that returns null (non-OK transcript response) still clears the live turn', async () => {
    const store = makeStore()
    let gone = false
    const { result } = await actRender(() => hookFor(store, 'a', {
      load: async (k: string) => (gone ? null : { messages: store.transcripts.get(k) ?? [] }),
    }))
    await act(async () => {})
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    gone = true
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => result.current.liveChunks === null, { label: 'live cleared after null settle load' })
    expect(result.current.streaming).toBe(false)
  })

  it('an older in-flight load (started before the settle) never drops the retained turn; the settle load does', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void; reject: (e: Error) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve, reject) => {
      pending.push({ resolve: messages => resolve({ messages }), reject })
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, events: { ...EVENTS, appended: 'conv.test.appended' } }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    // A refresh started mid-turn (still pending) …
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 2, { label: 'mid-turn load started' })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 3, { label: 'settle load started' })
    // … fails after the settle: it started before the settle, so it must not drop the
    // retained turn (the send guard would not catch a throw — only the sequence floor does).
    await act(async () => { pending[1]!.reject(new Error('offline')) })
    await act(async () => {})
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'reply' }])
    await act(async () => {
      pending[2]!.resolve([{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' }])
    })
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.messages).toHaveLength(1)
  })

  it('an older in-flight load that returns null after the settle never drops the retained turn either', async () => {
    const pending: Array<{ resolve: (body: { messages: ConversationMessage[] } | null) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] } | null>((resolve) => {
      pending.push({ resolve })
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve({ messages: [] }) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 2, { label: 'mid-turn load started' })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 3, { label: 'settle load started' })
    await act(async () => { pending[1]!.resolve(null) })
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'reply' }])
    await act(async () => { pending[2]!.resolve({ messages: [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' }] }) })
    expect(result.current.liveChunks).toBeNull()
  })

  it('a send that fails while the previous turn\'s settle load is in flight: the reply still arrives and the failed message stays', async () => {
    // Round-2 finding: the send bumped the sequence, the settle load was rejected, and the
    // previous reply never showed — only the failed optimistic row.
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    const store = makeStore()
    store.postResult = { ok: false, status: 500, error: 'boom' }
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'first' }]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    await act(async () => { await result.current.send('second') })
    expect(result.current.sendError).toBe('boom')
    const aRows: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'first' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' },
    ]
    // The stale settle load is rejected — and replaced by a fresh one.
    await act(async () => { pending[1]!.resolve(aRows) })
    await waitUntil(() => pending.length === 3, { label: 'replacement load started' })
    await act(async () => { pending[2]!.resolve(aRows) })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['first', 'turn A', 'second'])
    expect(result.current.liveChunks).toBeNull()
    expect(result.current.streaming).toBe(false)
    // The next SUCCESSFUL send retires the failed row (its text was abandoned or retyped).
    store.postResult = { ok: true }
    await act(async () => { await result.current.send('third') })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['first', 'turn A', 'third'])
    expect(pending).toHaveLength(3) // a plain send starts no load
  })

  it('a send accepted while the previous settle load is in flight keeps its optimistic row through the replacement load, with no duplicate once durable', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    await act(async () => { await result.current.send('second') })
    const aRows: ConversationMessage[] = [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' }]
    await act(async () => { pending[1]!.resolve(aRows) })
    await waitUntil(() => pending.length === 3, { label: 'replacement load started' })
    // The replacement started after the POST was acknowledged, so it carries the row —
    // the optimistic twin retires without a content match (the ack is the durability signal).
    const withB: ConversationMessage[] = [...aRows, { kind: 'user', ts: '2026-07-20T00:00:02Z', content: 'second' }]
    await act(async () => { pending[2]!.resolve(withB) })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['turn A', 'second'])
    expect(result.current.liveChunks).toEqual([])
    expect(result.current.streaming).toBe(true)
    // B settles: its durable row replaces the optimistic one, nothing doubles.
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 4, { label: 'B settle load started' })
    await act(async () => {
      pending[3]!.resolve([...aRows,
        { kind: 'user', ts: '2026-07-20T00:00:02Z', content: 'second' },
        { kind: 'assistant', ts: '2026-07-20T00:00:03Z', turnId: 'tB', content: 'turn B' }])
    })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['turn A', 'second', 'turn B'])
    expect(result.current.liveChunks).toBeNull()
  })

  it('two sends failing in a row while the settle load is in flight: the obligation carries across the replacement', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    const store = makeStore()
    store.postResult = { ok: false, status: 500, error: 'boom' }
    const { result } = await actRender(() => hookFor(store, 'a', { load }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    await act(async () => { await result.current.send('second') })
    const aRows: ConversationMessage[] = [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' }]
    await act(async () => { pending[1]!.resolve(aRows) })
    await waitUntil(() => pending.length === 3, { label: 'replacement load started' })
    // A second failed send invalidates the replacement too.
    await act(async () => { await result.current.send('third') })
    await act(async () => { pending[2]!.resolve(aRows) })
    await waitUntil(() => pending.length === 4, { label: 'second replacement load started' })
    await act(async () => { pending[3]!.resolve(aRows) })
    // Both failed rows stay (each is the user's only copy) until a send succeeds.
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['turn A', 'second', 'third'])
    expect(result.current.liveChunks).toBeNull()
  })

  it('an optimistic row is never consumed by identical text in history, and one durable row retires one pending row', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    let resolvePost: (v: Store['postResult']) => void = () => {}
    const post = () => new Promise<Store['postResult']>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const history: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'yes' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't0', content: 'ok' },
    ]
    const { result } = await actRender(() => hookFor(store, 'a', { load, post }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve(history) })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('yes') })
    // A refetch (an appended check-in) that read storage before the POST landed.
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 2, { label: 'refetch started' })
    await act(async () => { pending[1]!.resolve(history) })
    expect(result.current.messages.map(m => (m.kind === 'user' ? m.content : m.kind))).toEqual(['yes', 'assistant', 'yes'])
    // The POST then fails: the row is still there to mark failed.
    await act(async () => { resolvePost({ ok: false, status: 500, error: 'boom' }); await sent })
    expect(result.current.sendError).toBe('boom')
    expect(result.current.messages).toHaveLength(3)
  })

  it('a queued successor in the settle load never doubles the optimistic row', async () => {
    const pending: Array<{ resolve: (body: { messages: ConversationMessage[]; queued?: Array<{ id: string; ts: string; content: string }> }) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => { pending.push({ resolve }) })
    const store = makeStore()
    const posts: Array<{ ok: boolean; queued?: { id: string } }> = [{ ok: true }, { ok: true, queued: { id: 'q1' } }]
    const { result } = await actRender(() => hookFor(store, 'a', { load, post: async () => posts.shift()!, queue: { enabled: true } }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve({ messages: [] }) })
    await act(async () => { await result.current.send('B') })
    await act(async () => { await result.current.send('C') }) // queued while B streams
    expect(result.current.queued.map(q => q.id)).toEqual(['q1'])
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    const durable: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'B' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tB', content: 'reply B' },
      { kind: 'user', ts: '2026-07-20T00:00:02Z', content: 'C' },
    ]
    await act(async () => { pending[1]!.resolve({ messages: durable, queued: [] }) })
    expect(result.current.messages).toEqual(durable)
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 3, { label: 'refresh started' })
    await act(async () => { pending[2]!.resolve({ messages: durable, queued: [] }) })
    expect(result.current.messages).toEqual(durable)
  })

  it('an attachment-only send retires on its acknowledgment, never by matching the engine\'s placeholder', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    let resolvePost: (v: Store['postResult']) => void = () => {}
    const post = () => new Promise<Store['postResult']>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', {
      load,
      post,
      optimisticRow: (content: string) => ({ kind: 'user', ts: '2026-07-20T00:00:00Z', content, attachments: [{ name: 'pic.png', mimeType: 'image/png', url: '/x/pic.png' }] }),
    }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('') })
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 2, { label: 'racing refetch started' })
    const durable: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'See the attached image.', attachments: [{ name: 'pic.png', mimeType: 'image/png', url: '/x/pic.png' }] },
    ]
    // A refetch that raced the POST keeps the optimistic row beside the durable one…
    await act(async () => { pending[1]!.resolve(durable) })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toEqual(durable[0])
    // …and the acknowledgment, seeing a load raced it, owes one more load that retires it —
    // no content matching needed.
    await act(async () => { resolvePost({ ok: true }); await sent })
    await waitUntil(() => pending.length === 3, { label: 'post-ack refetch started' })
    await act(async () => { pending[2]!.resolve(durable) })
    expect(result.current.messages).toEqual(durable)
  })

  it('two sends with identical text around a settle each keep their own row; the second failing keeps its text', async () => {
    // Round-4 finding: with content matching, A's durable "yes" retired B's optimistic "yes".
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    let resolvePost: (v: Store['postResult']) => void = () => {}
    let calls = 0
    const post = () => new Promise<Store['postResult']>((resolve) => {
      calls += 1
      if (calls === 1) resolve({ ok: true })
      else resolvePost = resolve
    })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, post }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => { await result.current.send('yes') })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    // The second "yes" is sent while its POST stays unanswered…
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('yes') })
    const aRows: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'yes' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'ok' },
    ]
    // …and a consumer refresh carrying the FIRST send's identical text applies meanwhile.
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 3, { label: 'refresh started' })
    await act(async () => { pending[2]!.resolve(aRows) })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['yes', 'ok', 'yes'])
    // The POST then fails: the row is still there to keep.
    await act(async () => { resolvePost({ ok: false, status: 500, error: 'boom' }); await sent })
    expect(result.current.sendError).toBe('boom')
    // The stale settle load is rejected and owes nothing more — the refresh already settled.
    await act(async () => { pending[1]!.resolve(aRows) })
    await act(async () => {})
    expect(pending).toHaveLength(3)
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['yes', 'ok', 'yes'])
  })

  it('a plain send the server answers with "queued" moves to the queue instead of posing as a transcript row', async () => {
    // Round-4 finding: streaming was false locally while the server was still busy; the
    // optimistic row was kept and "acknowledged" although only the queue held the message.
    const store = makeStore()
    store.transcripts.set('a', [])
    const { result } = await actRender(() => hookFor(store, 'a', {
      post: async () => ({ ok: true, queued: { id: 'q9' } }),
      queue: { enabled: true },
    }))
    await act(async () => {})
    await act(async () => { await result.current.send('late') })
    expect(result.current.messages).toEqual([])
    expect(result.current.queued.map(q => q.id)).toEqual(['q9'])
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toBeNull()
  })

  it('a successful queued send retires an earlier failed row from the screen', async () => {
    const posts: Array<{ ok: boolean; status?: number; error?: string; queued?: { id: string } }> = [
      { ok: false, status: 500, error: 'boom' },
      { ok: true, queued: { id: 'q1' } },
    ]
    const store = makeStore()
    store.transcripts.set('a', [])
    const { result } = await actRender(() => hookFor(store, 'a', { post: async () => posts.shift()!, queue: { enabled: true } }))
    await act(async () => {})
    await act(async () => { await result.current.send('lost') })
    expect(result.current.messages.map(m => (m.kind === 'user' ? m.content : m.kind))).toEqual(['lost'])
    // The server starts a turn of its own (a drained follow-up): streaming again.
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'hi' } })
    })
    await act(async () => { await result.current.send('again') })
    expect(result.current.queued.map(q => q.id)).toEqual(['q1'])
    expect(result.current.messages).toEqual([])
  })

  it('the owed settle load waits for an in-flight send to answer, so it always starts after the acknowledgment', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    let resolvePost: (v: Store['postResult']) => void = () => {}
    const post = () => new Promise<Store['postResult']>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, post }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await waitUntil(() => pending.length === 2, { label: 'settle load started' })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('second') })
    const aRows: ConversationMessage[] = [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' }]
    await act(async () => { pending[1]!.resolve(aRows) })
    await act(async () => {})
    expect(pending).toHaveLength(2) // no replacement while the POST is unanswered
    await act(async () => { resolvePost({ ok: true }); await sent })
    await waitUntil(() => pending.length === 3, { label: 'replacement load started after the ack' })
    await act(async () => { pending[2]!.resolve([...aRows, { kind: 'user', ts: '2026-07-20T00:00:02Z', content: 'second' }]) })
    expect(result.current.messages.map(m => (m.kind === 'user' || m.kind === 'assistant' ? m.content : m.kind))).toEqual(['turn A', 'second'])
    expect(result.current.liveChunks).toEqual([])
  })

  it('a turn that settles before its own send is acknowledged defers the settle load until the ack', async () => {
    // Round-5 finding: the settle load read the row before the ack rule could retire it —
    // a durable twin beside the optimistic row, for good.
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve: messages => resolve({ messages }) })
    })
    let resolvePost: (v: Store['postResult']) => void = () => {}
    const post = () => new Promise<Store['postResult']>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, post }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('fast') })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'reply' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await act(async () => {})
    expect(pending).toHaveLength(1) // no settle load while the POST is unanswered
    expect(result.current.streaming).toBe(false)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'reply' }]) // still on screen
    await act(async () => { resolvePost({ ok: true }); await sent })
    await waitUntil(() => pending.length === 2, { label: 'settle load started after the ack' })
    const durable: ConversationMessage[] = [
      { kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'fast' },
      { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' },
    ]
    await act(async () => { pending[1]!.resolve(durable) })
    expect(result.current.messages).toEqual(durable)
    expect(result.current.liveChunks).toBeNull()
  })

  it('a send still running for the previous thread neither blocks nor breaks the new thread\'s owed settle', async () => {
    const pending: Array<{ key: string; resolve: (messages: ConversationMessage[]) => void }> = []
    const load = (key: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ key, resolve: messages => resolve({ messages }) })
    })
    const posts: Array<(v: Store['postResult']) => void> = []
    const post = () => new Promise<Store['postResult']>((resolve) => { posts.push(resolve) })
    const store = makeStore()
    const { result, rerender } = await actRender(() => hookFor(store, 'a', { load, post }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve([]) })
    await act(async () => { void result.current.send('in a') }) // stays unanswered
    await act(async () => { rerender({ key: 'b' }) })
    await waitUntil(() => pending.length === 2, { label: 'b mount load started' })
    await act(async () => { pending[1]!.resolve([]) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'b', chunk: { type: 'text', content: 'turn B' } })
    })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'b' }) })
    await waitUntil(() => pending.length === 3, { label: 'b settle load started' })
    let sentB!: Promise<void>
    await act(async () => { sentB = result.current.send('in b') })
    await act(async () => { pending[2]!.resolve([]) }) // rejected: a send landed
    await act(async () => { posts[1]!({ ok: true }); await sentB })
    // b's own send answered: its owed settle runs although a's POST never did.
    await waitUntil(() => pending.length === 4, { label: 'b replacement load started' })
    expect(pending[3]!.key).toBe('b')
  })

  it('a plain send answered "queued" invalidates a refresh that read the queue before the acknowledgment', async () => {
    const pending: Array<{ resolve: (body: { messages: ConversationMessage[]; queued?: Array<{ id: string; ts: string; content: string }> }) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => { pending.push({ resolve }) })
    let resolvePost: (v: { ok: boolean; queued?: { id: string } }) => void = () => {}
    const post = () => new Promise<{ ok: boolean; queued?: { id: string } }>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, post, queue: { enabled: true } }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve({ messages: [] }) })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('late') })
    act(() => { void result.current.refresh() })
    await waitUntil(() => pending.length === 2, { label: 'refresh started' })
    await act(async () => { resolvePost({ ok: true, queued: { id: 'q9' } }); await sent })
    expect(result.current.queued.map(q => q.id)).toEqual(['q9'])
    await act(async () => { pending[1]!.resolve({ messages: [], queued: [] }) }) // pre-ack snapshot
    expect(result.current.queued.map(q => q.id)).toEqual(['q9'])
    expect(result.current.messages).toEqual([])
  })

  it('a plain send answered "queued" while the server was still replying keeps that reply on screen', async () => {
    const store = makeStore()
    store.transcripts.set('a', [])
    let resolvePost: (v: { ok: boolean; queued?: { id: string } }) => void = () => {}
    const post = () => new Promise<{ ok: boolean; queued?: { id: string } }>((resolve) => { resolvePost = resolve })
    const { result } = await actRender(() => hookFor(store, 'a', { post, queue: { enabled: true } }))
    await act(async () => {})
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('late') })
    // A drained follow-up's reply streams in meanwhile.
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'busy reply' } })
    })
    await act(async () => { resolvePost({ ok: true, queued: { id: 'q1' } }); await sent })
    expect(result.current.queued.map(q => q.id)).toEqual(['q1'])
    expect(result.current.messages).toEqual([])
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'busy reply' }])
  })

  it('a queued send acknowledged after done but before the settle load lands still settles the turn and takes the queue from the server', async () => {
    // Round-2 finding: the late acknowledgment bumped the sequence, the settle load was
    // rejected, the finished turn stayed "live" and the consumed queue item reappeared.
    const pending: Array<{ resolve: (body: { messages: ConversationMessage[]; queued?: Array<{ id: string; ts: string; content: string }>; streaming?: boolean }) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push({ resolve })
    })
    let resolvePost: (v: { ok: boolean; queued?: { id: string } }) => void = () => {}
    const post = () => new Promise<{ ok: boolean; queued?: { id: string } }>((resolve) => { resolvePost = resolve })
    const store = makeStore()
    const { result } = await actRender(() => hookFor(store, 'a', { load, post, queue: { enabled: true } }))
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { pending[0]!.resolve({ messages: [] }) })
    await act(async () => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'turn A' } })
    })
    let sent!: Promise<void>
    await act(async () => { sent = result.current.send('follow-up') })
    await act(async () => { emitPluginEvent({ event: EVENTS.done, threadKey: 'a' }) })
    await act(async () => {})
    // The settle load waits for the unanswered POST; the turn stays on screen meanwhile.
    expect(pending).toHaveLength(1)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'turn A' }])
    await act(async () => { resolvePost({ ok: true, queued: { id: 'q1' } }); await sent })
    expect(result.current.queued.map(q => q.id)).toEqual(['q1'])
    await waitUntil(() => pending.length === 2, { label: 'settle load started after the ack' })
    // The server already started the follow-up: the item is gone from the queue, the turn is live.
    await act(async () => {
      pending[1]!.resolve({
        messages: [
          { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'tA', content: 'turn A' },
          { kind: 'user', ts: '2026-07-20T00:00:02Z', content: 'follow-up' },
        ],
        queued: [],
        streaming: true,
      })
    })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.queued).toEqual([])
    expect(result.current.liveChunks).toEqual([])
    expect(result.current.streaming).toBe(true)
  })

  it('thread switch resets state and ignores events for the previous thread', async () => {
    const store = makeStore()
    store.transcripts.set('a', [{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'in-a' }])
    store.transcripts.set('b', [])
    const { result, rerender } = hookFor(store, 'a')
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    rerender({ key: 'b' })
    await act(async () => {})
    expect(result.current.messages).toEqual([])
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'stale' } })
    })
    expect(result.current.liveChunks).toBeNull()
    expect(store.loads).toEqual(['a', 'b'])
  })

  it('a server-seeded streaming flag rehydrates the in-flight indicator on mount (embedded rehydration)', async () => {
    const store = makeStore()
    store.streamingFlags.set('a', true)
    store.transcripts.set('a', [{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'long job' }])
    const { result } = hookFor(store, 'a')
    await waitFor(() => expect(result.current.streaming).toBe(true))
    expect(result.current.liveChunks).toEqual([])
    // The still-running turn's next chunk keeps accumulating normally.
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'more' } })
    })
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'more' }])
  })

  it('a custom optimisticRow shapes the echoed user message (attachment URL mapping seam)', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', {
      optimisticRow: (content: string) => ({
        kind: 'user',
        ts: '2026-07-20T00:00:00Z',
        content,
        attachments: [{ name: 'pic.png', mimeType: 'image/png', url: '/api/x/pic.png' }],
      }),
    })
    await act(async () => {})
    await act(async () => { await result.current.send('with pic') })
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: 'user',
      content: 'with pic',
      attachments: [{ name: 'pic.png', url: '/api/x/pic.png' }],
    })
  })
})

describe('review-hardening guards (#703)', () => {
  it('refuses a send while a turn is streaming instead of wiping the live turn', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a')
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'live so far' } })
    })
    await act(async () => { await result.current.send('impatient follow-up') })
    // Live turn untouched, no POST fired, honest error surfaced.
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'live so far' }])
    expect(store.posts).toHaveLength(0)
    expect(result.current.sendError).toBe('A reply is already in progress')
  })

  it('a load started before the newest send never clobbers the optimistic row', async () => {
    const store = makeStore()
    let resolveLoad: (() => void) | null = null
    const { result } = renderHook(() =>
      useConversationThread({
        threadKey: 'a',
        events: EVENTS,
        keyOf: (p) => p.threadKey,
        load: () => new Promise<{ messages: ConversationMessage[] } | null>((resolve) => {
          resolveLoad = () => resolve({ messages: [] }) // stale pre-send snapshot
        }),
        post: async () => ({ ok: true }),
      }),
    )
    await act(async () => {}) // mount load now pending
    await act(async () => { await result.current.send('brand new message') })
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'brand new message' })
    await act(async () => { resolveLoad?.() })
    // The stale load resolved AFTER the send — the optimistic row survives.
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'brand new message' })
  })

  it('a throwing post rolls back and surfaces the error instead of rejecting', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', {
      post: async () => { throw new Error('socket down') },
    })
    await act(async () => {})
    await act(async () => { await result.current.send('doomed') })
    expect(result.current.streaming).toBe(false)
    expect(result.current.sendError).toBe('socket down')
  })

  it('queue-enabled: a send while streaming posts and records a queued row — no busy error, live turn untouched', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', {
      queue: { enabled: true, queuedEvent: 'probe.queued', startedEvent: 'probe.started' },
      post: async (k: string, content: string) => {
        store.posts.push({ key: k, content })
        return { ok: true, queued: { id: 'qid-1', queueLength: 1 } }
      },
    })
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'live so far' } })
    })
    await act(async () => { await result.current.send('queued follow-up') })
    expect(store.posts).toHaveLength(1)
    expect(result.current.sendError).toBeNull()
    // Live turn untouched; the message landed in the queue, not messages.
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'live so far' }])
    expect(result.current.messages.some((m) => (m as { content?: string }).content === 'queued follow-up')).toBe(false)
    expect(result.current.queued).toHaveLength(1)
    expect(result.current.queued[0]).toMatchObject({ id: 'qid-1', content: 'queued follow-up' })
  })

  it('queue-enabled idle send is the normal optimistic path; server queued list hydrates from load', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', {
      queue: { enabled: true },
      load: async () => ({
        messages: [],
        queued: [{ id: 'srv-1', ts: '2026-07-25T00:00:00Z', content: 'from server' }],
      }),
    })
    await waitFor(() => expect(result.current.queued).toHaveLength(1))
    await act(async () => { await result.current.send('normal idle send') })
    expect(result.current.messages.at(-1)).toMatchObject({ kind: 'user', content: 'normal idle send' })
    expect(result.current.streaming).toBe(true)
  })

  it('a queued-event refetch that already delivered the item never duplicates the optimistic row', async () => {
    const store = makeStore()
    const serverQueue: Array<{ id: string; ts: string; content: string }> = []
    let resolvePost: ((v: { ok: boolean; queued?: { id: string } }) => void) | null = null
    const { result } = hookFor(store, 'a', {
      queue: { enabled: true, queuedEvent: 'probe.queued' },
      load: async () => ({ messages: [], queued: [...serverQueue] }),
      post: () => new Promise((r) => { resolvePost = r as typeof resolvePost }),
    })
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'live' } })
    })
    let sendPromise: Promise<void> = Promise.resolve()
    act(() => { sendPromise = result.current.send('dupe me not') })
    // Server-side: the enqueue lands and its event fires BEFORE the 202
    // response is written — the refetch delivers the item first.
    serverQueue.push({ id: 'dup-1', ts: '2026-07-25T00:00:00Z', content: 'dupe me not' })
    act(() => { emitPluginEvent({ event: 'probe.queued', threadKey: 'a', queueId: 'dup-1', queueLength: 1 }) })
    await waitFor(() => expect(result.current.queued).toHaveLength(1))
    // Now the 202 resolves with the same id — no second bubble.
    await act(async () => {
      resolvePost?.({ ok: true, queued: { id: 'dup-1' } })
      await sendPromise
    })
    expect(result.current.queued).toHaveLength(1)
    expect(result.current.queued[0].id).toBe('dup-1')
  })

  it('queued/started events refetch queue state for the active thread', async () => {
    const store = makeStore()
    const serverQueue: Array<{ id: string; ts: string; content: string }> = []
    const { result } = hookFor(store, 'a', {
      queue: { enabled: true, queuedEvent: 'probe.queued', startedEvent: 'probe.started' },
      load: async (k: string) => {
        store.loads.push(k)
        return { messages: [], queued: [...serverQueue] }
      },
    })
    await act(async () => {})
    serverQueue.push({ id: 'q-other-tab', ts: '2026-07-25T00:00:00Z', content: 'from another tab' })
    act(() => { emitPluginEvent({ event: 'probe.queued', threadKey: 'a', queueId: 'q-other-tab', queueLength: 1 }) })
    await waitFor(() => expect(result.current.queued).toHaveLength(1))

    serverQueue.length = 0 // drain started server-side
    act(() => { emitPluginEvent({ event: 'probe.started', threadKey: 'a' }) })
    await waitFor(() => expect(result.current.queued).toHaveLength(0))
  })

  it('removeQueued calls the consumer remove, drops the row locally, and returns the removed item for restore', async () => {
    const store = makeStore()
    const removed: string[] = []
    const { result } = hookFor(store, 'a', {
      queue: {
        enabled: true,
        remove: async (_k: string, id: string) => { removed.push(id); return true },
      },
      load: async () => ({
        messages: [],
        queued: [{ id: 'q1', ts: '2026-07-25T00:00:00Z', content: 'reword me' }],
      }),
    })
    await waitFor(() => expect(result.current.queued).toHaveLength(1))
    let item: unknown
    await act(async () => { item = await result.current.removeQueued('q1') })
    expect(removed).toEqual(['q1'])
    expect(item).toMatchObject({ id: 'q1', content: 'reword me' })
    expect(result.current.queued).toHaveLength(0)
    // Unknown id: no-op, null.
    await act(async () => { item = await result.current.removeQueued('nope') })
    expect(item).toBeNull()
  })

  it('default surfaces expose an empty queue and still refuse streaming sends', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a')
    await act(async () => {})
    act(() => {
      emitPluginEvent({ event: EVENTS.chunk, threadKey: 'a', chunk: { type: 'text', content: 'live' } })
    })
    await act(async () => { await result.current.send('nope') })
    expect(result.current.sendError).toBe('A reply is already in progress')
    expect(result.current.queued).toEqual([])
  })

  it('switching threads clears the old transcript even when the new load fails', async () => {
    const store = makeStore()
    store.transcripts.set('a', [{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'from A' }])
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useConversationThread({
          threadKey: key,
          events: EVENTS,
          keyOf: (p) => p.threadKey,
          load: async (k) => (k === 'a' ? { messages: store.transcripts.get('a') ?? [] } : null),
          post: async () => ({ ok: true }),
        }),
      { initialProps: { key: 'a' } },
    )
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    rerender({ key: 'gone' })
    await act(async () => {})
    // Thread A's transcript must never render under thread "gone".
    expect(result.current.messages).toEqual([])
    expect(result.current.meta).toBeNull()
  })
})

describe('appended rows (projects revamp D24a)', () => {
  it('an appended event for the idle active thread refetches the transcript', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', { events: { ...EVENTS, appended: 'probe.appended' } })
    await waitFor(() => expect(store.loads).toEqual(['a']))
    store.transcripts.set('a', [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 'steward:t1', content: 'Checked in.' }])
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'a' }) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    // Other threads are ignored.
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'b' }) })
    expect(store.loads).toEqual(['a', 'a'])
  })

  it('an appended event mid-stream never settles or refetches over the live turn', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', { events: { ...EVENTS, appended: 'probe.appended' } })
    await waitFor(() => expect(store.loads).toEqual(['a']))
    await act(async () => { emitPluginEvent({ event: 'probe.chunk', threadKey: 'a', chunk: { type: 'text', content: 'working' } }) })
    expect(result.current.streaming).toBe(true)
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'a' }) })
    expect(result.current.streaming).toBe(true)
    expect(result.current.liveChunks).toEqual([{ type: 'text', content: 'working' }])
    expect(store.loads).toEqual(['a'])
  })

  it('done then appended in the SAME tick (before a render) still refetches — the flush lands after the settle load', async () => {
    const store = makeStore()
    const { result } = hookFor(store, 'a', { events: { ...EVENTS, appended: 'probe.appended' } })
    await waitFor(() => expect(store.loads).toEqual(['a']))
    await act(async () => { emitPluginEvent({ event: 'probe.chunk', threadKey: 'a', chunk: { type: 'text', content: 'reply' } }) })
    expect(result.current.streaming).toBe(true)
    await act(async () => {
      // The settle load reads storage BEFORE the out-of-turn rows flush…
      store.transcripts.set('a', [{ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' }])
      emitPluginEvent({ event: 'probe.done', threadKey: 'a' })
      // …then the flush writes them and announces, before any re-render.
      store.transcripts.set('a', [
        { kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't1', content: 'reply' },
        { kind: 'assistant', ts: '2026-07-20T00:00:02Z', turnId: 'steward:t2', content: 'question' },
      ])
      emitPluginEvent({ event: 'probe.appended', threadKey: 'a' })
    })
    await waitFor(() => expect(result.current.messages.map((m) => (m as { content: string }).content)).toEqual(['reply', 'question']))
    expect(store.loads).toEqual(['a', 'a', 'a'])
  })

  it('overlapping loads apply in start order — an older response never erases a newer one', async () => {
    const row = (content: string): ConversationMessage => ({ kind: 'assistant', ts: '2026-07-20T00:00:01Z', turnId: 't', content })
    // Each load parks on a deferred the test resolves out of order.
    const pending: Array<(messages: ConversationMessage[]) => void> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve) => {
      pending.push(messages => resolve({ messages }))
    })
    const store = makeStore()
    const { result } = hookFor(store, 'a', { events: { ...EVENTS, appended: 'probe.appended' }, load })
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'a' }) })
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'a' }) })
    expect(pending).toHaveLength(3)

    // Newest first: it shows both rows.
    await act(async () => { pending[2]!([row('first'), row('question')]) })
    expect(result.current.messages.map(m => (m as { content: string }).content)).toEqual(['first', 'question'])
    // The older snapshots land late and are dropped.
    await act(async () => { pending[1]!([row('first')]) })
    await act(async () => { pending[0]!([]) })
    expect(result.current.messages).toHaveLength(2)
  })

  it('a failed newer load never blocks an older success', async () => {
    const pending: Array<{ resolve: (messages: ConversationMessage[]) => void; reject: (error: Error) => void }> = []
    const load = (_k: string) => new Promise<{ messages: ConversationMessage[] }>((resolve, reject) => {
      pending.push({ resolve: messages => resolve({ messages }), reject })
    })
    const store = makeStore()
    const { result } = hookFor(store, 'a', { events: { ...EVENTS, appended: 'probe.appended' }, load })
    await waitUntil(() => pending.length === 1, { label: 'mount load started' })
    await act(async () => { emitPluginEvent({ event: 'probe.appended', threadKey: 'a' }) })
    await act(async () => { pending[1]!.reject(new Error('server restarting')) })
    await act(async () => { pending[0]!.resolve([{ kind: 'user', ts: '2026-07-20T00:00:00Z', content: 'hi' }]) })
    expect(result.current.messages).toHaveLength(1)
  })
})
