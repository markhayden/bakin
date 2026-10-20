// @vitest-environment jsdom
/**
 * useOperation (#895 D3/D9): rev and boot guards, reconcile, expired vs
 * restarted vs unreachable, and the startOperation helper.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure hook test — no storage access. Defensive content-dir mocks per convention.
const testDir = join(tmpdir(), 'bakin-test-use-operation')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))

import type { OperationView } from '@makinbakin/sdk/types'
import { emitPluginEvent } from '../../src/hooks/use-plugin-event'
import {
  initialFollowState,
  OperationStartError,
  reduceOperationFollow,
  startOperation,
  useOperation,
} from '../../src/hooks/use-operation'
import { settleFor, waitUntil } from '../helpers/wait'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = originalFetch })
afterEach(() => { globalThis.fetch = originalFetch })

function view(over: Partial<OperationView> = {}): OperationView {
  return {
    id: 'op-1',
    children: [],
    rev: 1,
    bootId: 'boot-a',
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install',
    fingerprint: 'install:x',
    resources: ['install-state'],
    status: 'running',
    plan: { stages: [{ id: 'fetch', kind: 'downloading', label: 'Fetch' }, { id: 'place', kind: 'installing', label: 'Place' }], pointOfNoReturn: 'place' },
    stages: [
      { id: 'fetch', kind: 'downloading', label: 'Fetch', status: 'active' },
      { id: 'place', kind: 'installing', label: 'Place', status: 'pending' },
    ],
    cancellable: true,
    startedAt: '2026-10-16T00:00:00.000Z',
    lastProgressAt: '2026-10-16T00:00:00.000Z',
    lastLivenessAt: '2026-10-16T00:00:00.000Z',
    log: [],
    ...over,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function event(v: OperationView) {
  act(() => emitPluginEvent({ event: 'operation.updated', view: v }))
}

describe('reduceOperationFollow', () => {
  const live = () => reduceOperationFollow(initialFollowState('op-1', 'boot-a'), { type: 'read', bootId: 'boot-a', operation: view({ rev: 5 }) })

  it('keeps the highest rev: an older read or event never regresses state', () => {
    const state = live()
    expect(reduceOperationFollow(state, { type: 'read', bootId: 'boot-a', operation: view({ rev: 3 }) }).operation?.rev).toBe(5)
    expect(reduceOperationFollow(state, { type: 'event', view: view({ rev: 5, title: 'same rev' }) }).operation?.title).toBe('Install')
    expect(reduceOperationFollow(state, { type: 'event', view: view({ rev: 6 }) }).operation?.rev).toBe(6)
  })

  it('ignores events from another boot', () => {
    expect(reduceOperationFollow(live(), { type: 'event', view: view({ rev: 9, bootId: 'boot-b' }) }).operation?.rev).toBe(5)
  })

  it('latches restarted on a read from another boot and ignores everything after', () => {
    const restarted = reduceOperationFollow(live(), { type: 'not-found', bootId: 'boot-b' })
    expect(restarted.phase).toBe('restarted')
    expect(restarted.operation?.rev).toBe(5)
    const late = reduceOperationFollow(restarted, { type: 'read', bootId: 'boot-a', operation: view({ rev: 7, status: 'succeeded' }) })
    expect(late).toBe(restarted)
  })

  it('marks a same-boot 404 expired, but keeps a finished view finished', () => {
    expect(reduceOperationFollow(live(), { type: 'not-found', bootId: 'boot-a' }).phase).toBe('expired')
    const finished = reduceOperationFollow(live(), { type: 'event', view: view({ rev: 6, status: 'succeeded' }) })
    expect(finished.phase).toBe('finished')
    expect(reduceOperationFollow(finished, { type: 'not-found', bootId: 'boot-a' }).phase).toBe('finished')
  })

  it('tracks children by parentId under the same rev guard', () => {
    const state = live()
    const child = view({ id: 'c1', parentId: 'op-1', rev: 2 })
    const withChild = reduceOperationFollow(state, { type: 'event', view: child })
    expect(withChild.children.c1?.rev).toBe(2)
    expect(reduceOperationFollow(withChild, { type: 'event', view: { ...child, rev: 1 } }).children.c1?.rev).toBe(2)
    expect(reduceOperationFollow(state, { type: 'event', view: view({ id: 'other', rev: 9 }) })).toBe(state)
  })
})

describe('useOperation', () => {
  it('a delayed older GET never regresses state set by a newer event', async () => {
    const slow = deferred<Response>()
    globalThis.fetch = mock(() => slow.promise) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1', { bootId: 'boot-a' })))
    expect(result.current.phase).toBe('loading')

    event(view({ rev: 4, stages: [{ id: 'fetch', kind: 'downloading', label: 'Fetch', status: 'done' }, { id: 'place', kind: 'installing', label: 'Place', status: 'active' }] }))
    expect(result.current.operation?.rev).toBe(4)

    await act(async () => { slow.resolve(json({ bootId: 'boot-a', operation: view({ rev: 2 }) })) })
    await act(() => settleFor(50, 'the delayed rev-2 read must land and be discarded'))
    expect(result.current.operation?.rev).toBe(4)
    expect(result.current.operation?.stages[1]?.status).toBe('active')
    expect(result.current.phase).toBe('live')
  })

  it('recovers a missed stage on reconcile', async () => {
    let served = view({ rev: 1 })
    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', operation: served })) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1')))
    await waitUntil(() => result.current.operation?.rev === 1, { label: 'first read' })

    // The stage-change milestone was missed while the stream was down.
    served = view({ rev: 3, stages: [{ id: 'fetch', kind: 'downloading', label: 'Fetch', status: 'done' }, { id: 'place', kind: 'installing', label: 'Place', status: 'active' }] })
    await act(async () => emitPluginEvent({ event: 'bakin.reconcile' }))
    await waitUntil(() => result.current.operation?.rev === 3, { label: 'reconciled' })
    expect(result.current.operation?.stages[0]?.status).toBe('done')
  })

  it('a changed bootId means restarted, and a late old-boot answer is ignored', async () => {
    const late = deferred<Response>()
    let call = 0
    globalThis.fetch = mock(() => {
      call += 1
      if (call === 1) return Promise.resolve(json({ bootId: 'boot-a', operation: view({ rev: 2 }) }))
      if (call === 2) return Promise.resolve(json({ bootId: 'boot-b', error: 'not_found' }, 404))
      return late.promise
    }) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1', { bootId: 'boot-a' })))
    await waitUntil(() => result.current.phase === 'live', { label: 'live' })

    await act(async () => emitPluginEvent({ event: 'bakin.reconcile' }))
    await waitUntil(() => result.current.phase === 'restarted', { label: 'restarted' })
    expect(result.current.operation?.rev).toBe(2)

    // Restarted is latched: no further reconcile is sent, and a stray old-boot event is ignored.
    await act(async () => emitPluginEvent({ event: 'bakin.reconcile' }))
    event(view({ rev: 9, status: 'succeeded' }))
    await act(async () => { late.resolve(json({ bootId: 'boot-a', operation: view({ rev: 10, status: 'succeeded' }) })) })
    await act(() => settleFor(50, 'no reconcile may be sent after restart'))
    expect(call).toBe(2)
    expect(result.current.phase).toBe('restarted')
    expect(result.current.operation?.rev).toBe(2)
  })

  it('same boot plus 404 is expired', async () => {
    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', error: 'not_found' }, 404)) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1', { bootId: 'boot-a' })))
    await waitUntil(() => result.current.phase === 'expired', { label: 'expired' })
    expect(result.current.operation).toBeNull()
  })

  it('unreachable keeps the last view and recovers by retrying', async () => {
    let call = 0
    globalThis.fetch = mock(async () => {
      call += 1
      if (call === 1) return json({ bootId: 'boot-a', operation: view({ rev: 2 }) })
      if (call === 2) throw new TypeError('Failed to fetch')
      return json({ bootId: 'boot-a', operation: view({ rev: 5, status: 'succeeded' }) })
    }) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1')))
    await waitUntil(() => result.current.phase === 'live', { label: 'live' })

    await act(async () => emitPluginEvent({ event: 'bakin.reconcile' }))
    await waitUntil(() => result.current.phase === 'unreachable', { label: 'unreachable' })
    expect(result.current.operation?.rev).toBe(2)

    // The backoff timer's read must land inside act; React commits when act exits.
    await act(async () => {
      await waitUntil(() => call >= 3, { label: 'retry sent', timeoutMs: 3_000 })
      await settleFor(20, 'let the retried read dispatch inside act')
    })
    expect(result.current.phase).toBe('finished')
    expect(result.current.operation?.rev).toBe(5)
  })

  it('orders children by the parent and cancel posts to the cancel route', async () => {
    const calls: string[] = []
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/cancel')) return json({ bootId: 'boot-a', status: 'cancelling' }, 202)
      return json({
        bootId: 'boot-a',
        operation: view({ children: ['c2', 'c1'] }),
        children: [view({ id: 'c1', parentId: 'op-1' }), view({ id: 'c2', parentId: 'op-1' })],
      })
    }) as unknown as typeof fetch
    const { result } = await actRender(() => renderHook(() => useOperation('op-1')))
    await waitUntil(() => result.current.children.length === 2, { label: 'children' })
    expect(result.current.children.map((c) => c.id)).toEqual(['c2', 'c1'])

    let status: string | undefined
    await act(async () => { status = await result.current.cancel() })
    expect(status).toBe('cancelling')
    expect(calls).toContain('POST /api/operations/op-1/cancel')
  })
})

describe('startOperation', () => {
  it('returns the start body on 202 and on an attached 200', async () => {
    expect(await startOperation(async () => json({ operationId: 'op-1', bootId: 'boot-a' }, 202))).toEqual({ operationId: 'op-1', bootId: 'boot-a' })
    expect(await startOperation(async () => json({ operationId: 'op-1', bootId: 'boot-a', attached: true }))).toEqual({ operationId: 'op-1', bootId: 'boot-a', attached: true })
  })

  it('throws the route refusal with its status and body', async () => {
    const err = await startOperation(async () => json({ error: 'Already installed' }, 409)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OperationStartError)
    expect((err as OperationStartError).status).toBe(409)
    expect((err as OperationStartError).message).toBe('Already installed')
    expect((err as OperationStartError).body).toEqual({ error: 'Already installed' })
  })

  it('onSettle fires once per followed operation — with the final view when it finishes, with null when it expires (#966b)', async () => {
    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', operation: view({ rev: 3, status: 'succeeded' }) })) as unknown as typeof fetch
    const settles: Array<[string | null, string]> = []
    const { result } = await actRender(() => renderHook(() => useOperation('op-1', { bootId: 'boot-a', onSettle: (op, phase) => { settles.push([op?.id ?? null, phase]) } })))
    await waitUntil(() => result.current.phase === 'finished', { label: 'finished' })
    expect(settles).toEqual([['op-1', 'finished']])
    // Later events for the same operation never re-fire the settle.
    event(view({ rev: 4, status: 'succeeded' }))
    await act(async () => emitPluginEvent({ event: 'bakin.reconcile' }))
    await act(() => settleFor(30, 'a settled operation reports once'))
    expect(settles).toHaveLength(1)

    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', error: 'not_found' }, 404)) as unknown as typeof fetch
    const expired: Array<[string | null, string]> = []
    const second = await actRender(() => renderHook(() => useOperation('op-2', { bootId: 'boot-a', onSettle: (op, phase) => { expired.push([op?.id ?? null, phase]) } })))
    await waitUntil(() => second.result.current.phase === 'expired', { label: 'expired' })
    expect(expired).toEqual([[null, 'expired']])
  })
})
