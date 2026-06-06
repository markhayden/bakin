/**
 * SSE refetch coalescing (#392): a burst of asset.changed/asset.removed
 * events inside the debounce window flushes exactly one list fetch (plus one
 * trash fetch iff any event in the burst was a removal); cancel() drops a
 * pending flush. Pure timer logic — no DOM, no EventSource.
 */
import { describe, it, expect, mock } from 'bun:test'

// The scheduler is a pure timer helper with an empty import graph, but every
// tests/plugins/** file pins the content-dir resolvers per CLAUDE.md so a
// future import can't silently reach ~/.bakin.
const noDir = () => { throw new Error('sse-refetch test must not touch the content dir') }
mock.module('../../../src/core/content-dir', () => ({ getContentDir: noDir, getBakinPaths: noDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: noDir, getBakinPaths: noDir }))

import { createSseRefetchScheduler } from '../../../plugins/assets/components/versioned/sse-refetch'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const WINDOW = 20

function harness() {
  let assets = 0
  let trash = 0
  const s = createSseRefetchScheduler(() => { assets++ }, () => { trash++ }, WINDOW)
  return { s, counts: () => ({ assets, trash }) }
}

describe('createSseRefetchScheduler', () => {
  it('coalesces a burst into exactly one assets fetch', async () => {
    const { s, counts } = harness()
    for (let i = 0; i < 10; i++) s.schedule(false)
    expect(counts()).toEqual({ assets: 0, trash: 0 }) // trailing: nothing yet
    await delay(WINDOW * 3)
    expect(counts()).toEqual({ assets: 1, trash: 0 })
  })

  it('folds a removal anywhere in the burst into one trash fetch', async () => {
    const { s, counts } = harness()
    s.schedule(false)
    s.schedule(true) // removal mid-burst
    s.schedule(false) // trailing change must not drop the trash flag
    await delay(WINDOW * 3)
    expect(counts()).toEqual({ assets: 1, trash: 1 })
  })

  it('separate bursts flush separately, trash flag resets between them', async () => {
    const { s, counts } = harness()
    s.schedule(true)
    await delay(WINDOW * 3)
    s.schedule(false)
    await delay(WINDOW * 3)
    expect(counts()).toEqual({ assets: 2, trash: 1 })
  })

  it('cancel() drops the pending flush (unmount mid-window)', async () => {
    const { s, counts } = harness()
    s.schedule(true)
    s.cancel()
    await delay(WINDOW * 3)
    expect(counts()).toEqual({ assets: 0, trash: 0 })
  })
})
