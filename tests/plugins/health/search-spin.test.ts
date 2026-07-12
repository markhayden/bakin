/**
 * Backfill-spin watchdog — pure detector tests (the check is a thin
 * adapter over the health snapshot; see search-spin.ts).
 */
import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// The detector under test is pure, but the module's check side dynamically
// imports storage-touching code — mock the resolvers so nothing can ever
// reach ~/.bakin (CLAUDE.md Testing Rules).
const testDir = join(tmpdir(), `bakin-test-search-spin-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { detectSpins, type SpinLegSnapshot } from '../../../plugins/health/lib/system-checks/search-spin'

const WINDOW = 10 * 60 * 1000
const leg = (over: Partial<SpinLegSnapshot> = {}): SpinLegSnapshot => ({
  logical: 'bakin_memory',
  leg: 'embeddings',
  building: true,
  indexedCount: 50,
  outboxPending: 0,
  ...over,
})

describe('detectSpins', () => {
  it('never fires on the first sample', () => {
    const { spins, nextState } = detectSpins(null, 1_000, [leg()], WINDOW)
    expect(spins).toEqual([])
    expect(nextState.counts['bakin_memory:embeddings']).toBe(50)
  })

  it('fires when a building leg made zero progress across a full window', () => {
    const first = detectSpins(null, 0, [leg()], WINDOW)
    const second = detectSpins(first.nextState, WINDOW, [leg()], WINDOW)
    expect(second.spins).toHaveLength(1)
    expect(second.spins[0]!.logical).toBe('bakin_memory')
  })

  it('does not fire when the count advanced', () => {
    const first = detectSpins(null, 0, [leg({ indexedCount: 50 })], WINDOW)
    const second = detectSpins(first.nextState, WINDOW, [leg({ indexedCount: 51 })], WINDOW)
    expect(second.spins).toEqual([])
    // the sample rolled forward to the new count
    expect(second.nextState.counts['bakin_memory:embeddings']).toBe(51)
  })

  it('does not fire while journal rows are pending (inflow explains work)', () => {
    const first = detectSpins(null, 0, [leg()], WINDOW)
    const second = detectSpins(first.nextState, WINDOW, [leg({ outboxPending: 3 })], WINDOW)
    expect(second.spins).toEqual([])
  })

  it('does not fire for legs that are not building', () => {
    const first = detectSpins(null, 0, [leg()], WINDOW)
    const second = detectSpins(first.nextState, WINDOW, [leg({ building: false })], WINDOW)
    expect(second.spins).toEqual([])
    // a ready leg leaves the sample entirely
    expect(second.nextState.counts['bakin_memory:embeddings']).toBeUndefined()
  })

  it('holds the original sample open until the window elapses', () => {
    const first = detectSpins(null, 0, [leg({ indexedCount: 50 })], WINDOW)
    const mid = detectSpins(first.nextState, WINDOW / 2, [leg({ indexedCount: 50 })], WINDOW)
    expect(mid.spins).toEqual([])
    expect(mid.nextState.at).toBe(0) // window not rolled
    const end = detectSpins(mid.nextState, WINDOW, [leg({ indexedCount: 50 })], WINDOW)
    expect(end.spins).toHaveLength(1)
  })

  it('a candidate appearing mid-window is measured from when it appeared', () => {
    const first = detectSpins(null, 0, [], WINDOW)
    const mid = detectSpins(first.nextState, WINDOW / 2, [leg({ indexedCount: 10 })], WINDOW)
    // window rolls at WINDOW: the newcomer was recorded at 10 mid-window
    const end = detectSpins(mid.nextState, WINDOW, [leg({ indexedCount: 10 })], WINDOW)
    expect(end.spins).toHaveLength(1)
  })
})
