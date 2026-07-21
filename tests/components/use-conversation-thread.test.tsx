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
import '../rtl-settle'

import { useConversationThread, type ConversationMessage } from '@makinbakin/sdk/components'
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
        load: () => new Promise((resolve) => {
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
