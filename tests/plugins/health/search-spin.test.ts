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

let reportTables: string[] = []
let scarredTables: string[] = []
mock.module('../../../src/core/doctor-report-cache', () => ({
  getHealthReport: () => ({
    observations: [
      ...(reportTables.length > 0 ? [{ checkId: 'health.search-spin', key: 'indexes.spin', status: 'error', evidence: { tables: reportTables } }] : []),
      ...(scarredTables.length > 0 ? [{ checkId: 'health.search', key: 'indexes.scars', status: 'warning', evidence: { scarredTables } }] : []),
    ],
  }),
}))
const rebuilt: string[] = []
mock.module('../../../src/core/search-registry', () => ({
  rebuildRegisteredTables: async (logical: string) => { rebuilt.push(logical); return [{ table: logical, result: 'migrated', indexed: 1 }] },
}))

import { detectSpins, rebuildTargets, searchSpinRepair, type SpinLegSnapshot } from '../../../plugins/health/lib/system-checks/search-spin'
import { searchScarRepair } from '../../../plugins/health/lib/system-checks/search'

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
  it('an engine-declared stalled leg spins IMMEDIATELY — no window wait, even with moving counts (#847)', () => {
    // The count-window inference misses a leg whose counters MOVE while the
    // engine itself declares the worker stalled; 0.2.2 hands us the signal.
    const stalledLeg = leg({ stalled: true, stallReason: 'inference queue saturated' })
    const first = detectSpins(null, 1_000, [stalledLeg], WINDOW)
    expect(first.spins).toEqual([stalledLeg])
    // …and it keeps firing mid-window while counts advance.
    const second = detectSpins(first.nextState, 2_000, [{ ...stalledLeg, indexedCount: stalledLeg.indexedCount + 50 }], WINDOW)
    expect(second.spins).toHaveLength(1)
    expect(second.spins[0].stallReason).toBe('inference queue saturated')
  })

  it('stalled=false behaves exactly as before — window inference only', () => {
    const { spins } = detectSpins(null, 1_000, [leg({ stalled: false })], WINDOW)
    expect(spins).toEqual([])
  })

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

describe('searchSpinRepair — concrete targets (frozen proposals must name real tables)', () => {
  it('plan emits one change per spinning table from the CURRENT report, not a vague "search tables"', async () => {
    reportTables = ['bakin_tasks', 'bakin_assets']
    const [item] = await searchSpinRepair().plan({ type: 'all_actionable', reportId: 'r1' })
    expect(item!.changes.map((change) => change.target)).toEqual(['bakin_tasks', 'bakin_assets'])
    reportTables = []
    const [none] = await searchSpinRepair().plan({ type: 'all_actionable', reportId: 'r1' })
    expect(none!.changes).toEqual([])
  })

  it('apply rebuilds exactly the tables the approved items name — never whatever the check last saw', async () => {
    reportTables = ['bakin_assets']
    rebuilt.length = 0
    const item = {
      id: 'search-spin-rebuild:rebuild-spinning-indexes', actionId: 'search-spin-rebuild', title: 'Rebuild', reason: 'spin', safety: 'destructive' as const,
      incidentIds: [], observationIds: [], preconditions: [],
      changes: [{ kind: 'other' as const, target: 'bakin_tasks', action: 'update' as const, description: 'rebuild' }],
    }
    expect(rebuildTargets([item])).toEqual(['bakin_tasks'])
    const [result] = await searchSpinRepair().apply([item])
    expect(rebuilt).toEqual(['bakin_tasks'])
    expect(result).toMatchObject({ status: 'applied', message: 'bakin_tasks: migrated' })
  })
})

describe('searchScarRepair — concrete targets', () => {
  it('plans one change per scarred table from the report and rebuilds only the approved items\' targets', async () => {
    scarredTables = ['bakin_assets', 'bakin_chats']
    const [item] = await searchScarRepair().plan({ type: 'all_actionable', reportId: 'r1' })
    expect(item!.changes.map((change) => change.target)).toEqual(['bakin_assets', 'bakin_chats'])
    rebuilt.length = 0
    await searchScarRepair().apply([{ ...item!, changes: [item!.changes[1]!] }])
    expect(rebuilt).toEqual(['bakin_chats'])
  })
})
