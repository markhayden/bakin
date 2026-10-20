/** Completion watches for applied updates (#1007 review r3 #7): one per operation, merged, fired once, disposed. */
import { afterEach, describe, expect, it } from 'bun:test'
import type { OperationView } from '@makinbakin/sdk/types'
import { disposeApplyWatches, watchOperationSucceeded, watchedOperationIds, type ApplyWatchRegistry } from '../../../src/core/updates/apply-watch'

function view(id: string, status: OperationView['status']): OperationView {
  const now = '2026-10-20T12:00:00.000Z'
  return { id, children: [], rev: 1, bootId: 'b', kind: 'upgrade', owner: 'core', origin: 'web', title: id, fingerprint: id, resources: [], status, plan: { stages: [], pointOfNoReturn: null }, stages: [], cancellable: false, startedAt: now, lastProgressAt: now, lastLivenessAt: now, log: [] }
}

function registry(): ApplyWatchRegistry & { emit: (v: OperationView) => void; listeners: () => number; views: Map<string, OperationView> } {
  const listeners = new Set<(view: OperationView) => void>()
  const views = new Map<string, OperationView>()
  return {
    views,
    get: (id) => views.get(id) ?? null,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    emit: (v) => { views.set(v.id, v); for (const l of [...listeners]) l(v) },
    listeners: () => listeners.size,
  }
}

afterEach(() => disposeApplyWatches())

describe('watchOperationSucceeded', () => {
  it('attachments and retries share ONE subscription whose ids merge; success fires once with the union, then the watch is gone', () => {
    const r = registry()
    const fired: string[][] = []
    watchOperationSucceeded(r, 'op-1', ['plugin:a'], (ids) => fired.push(ids))
    watchOperationSucceeded(r, 'op-1', ['plugin:b'], (ids) => fired.push(['second', ...ids]))
    watchOperationSucceeded(r, 'op-1', ['plugin:a'], (ids) => fired.push(['third', ...ids]))
    expect(r.listeners()).toBe(1)
    expect(watchedOperationIds()).toEqual(['op-1'])
    r.emit(view('op-1', 'running'))
    expect(fired).toEqual([])
    r.emit(view('op-1', 'succeeded'))
    r.emit(view('op-1', 'succeeded'))
    expect(fired).toEqual([['plugin:a', 'plugin:b']])
    expect(r.listeners()).toBe(0)
    expect(watchedOperationIds()).toEqual([])
  })

  it('a failed or cancelled operation drops its watch without firing; an already-finished attach settles at once', () => {
    const r = registry()
    const fired: string[][] = []
    watchOperationSucceeded(r, 'op-f', ['x'], (ids) => fired.push(ids))
    r.emit(view('op-f', 'failed'))
    expect(fired).toEqual([])
    expect(r.listeners()).toBe(0)
    r.views.set('op-done', view('op-done', 'succeeded'))
    watchOperationSucceeded(r, 'op-done', ['y'], (ids) => fired.push(ids))
    expect(fired).toEqual([['y']])
    expect(r.listeners()).toBe(0)
  })

  it('disposeApplyWatches drops every pending watch — a stuck operation never accumulates listeners', () => {
    const r = registry()
    watchOperationSucceeded(r, 'stuck-1', ['a'], () => {})
    watchOperationSucceeded(r, 'stuck-2', ['b'], () => {})
    expect(r.listeners()).toBe(2)
    disposeApplyWatches()
    expect(r.listeners()).toBe(0)
    expect(watchedOperationIds()).toEqual([])
    r.emit(view('stuck-1', 'succeeded')) // nothing fires, nothing throws
  })
})
