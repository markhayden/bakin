/** The update scheduler: due subjects, concurrency bound, per-subject deadline, coalescing, disable semantics (#1007, D7.5). */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-timer-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { createUpdatesEngine, UpdateSubjectNotFoundError, type UpdatesEngine } from '../../../src/core/updates/engine'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import { startUpdatesTimer, type UpdatesTimer } from '../../../src/core/updates/timer'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../../../src/core/updates/types'
import { settleFor, waitUntil } from '../../helpers/wait'

const current: UpdateObservation = { installed: { version: '1', display: '1' }, outcome: 'current' }

interface Scripted {
  source: UpdateSource
  /** Subject ids currently being observed. */
  inFlight: Set<string>
  maxInFlight: () => number
  calls: string[]
  /** Hold a subject's observation until released (or forever). */
  hold: (id: string, opts?: { honourSignal?: boolean }) => () => void
}

function scripted(kind: UpdateSource['kind'], ids: string[]): Scripted {
  const inFlight = new Set<string>()
  const calls: string[] = []
  let peak = 0
  const holds = new Map<string, { release: () => void; honourSignal: boolean; gate: Promise<void> }>()
  const source: UpdateSource = {
    kind,
    inventory: async () => ids.map((id): UpdateSubjectInventoryEntry => ({
      subject: { kind, id, label: id }, group: 'available', fingerprint: fingerprintOf({ id }), source: { kind: 'scripted', endpoint: `scripted://${id}` },
    })),
    observe: async (entry, { signal }) => {
      const id = entry.subject.id
      calls.push(id)
      inFlight.add(id)
      peak = Math.max(peak, inFlight.size)
      try {
        const hold = holds.get(id)
        if (hold) {
          if (hold.honourSignal) {
            await Promise.race([hold.gate, new Promise<never>((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })])
          } else {
            await hold.gate
          }
        }
        return current
      } finally {
        inFlight.delete(id)
      }
    },
  }
  return {
    source, inFlight, calls, maxInFlight: () => peak,
    hold(id, opts = {}) {
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      holds.set(id, { release, honourSignal: opts.honourSignal ?? false, gate })
      return release
    },
  }
}

const timers: UpdatesTimer[] = []
afterEach(() => { for (const timer of timers.splice(0)) timer.stop() })

function harness(sources: UpdateSource[], opts: { enabled?: () => boolean; tickMs?: number; firstTickMs?: number; subjectTimeoutMs?: number; cancelGraceMs?: number; intervalMs?: number | (() => number) } = {}): { engine: UpdatesEngine; timer: UpdatesTimer } {
  const engine = createUpdatesEngine({ storePath: join(testDir, `${randomUUID()}.json`), sources, intervalMs: opts.intervalMs ?? 3_600_000 })
  const timer = startUpdatesTimer({
    engine,
    settings: () => ({ enabled: opts.enabled?.() ?? true }),
    tickMs: opts.tickMs ?? 25,
    firstTickMs: opts.firstTickMs ?? 25,
    subjectTimeoutMs: opts.subjectTimeoutMs ?? 5_000,
    cancelGraceMs: opts.cancelGraceMs ?? 30,
  })
  timers.push(timer)
  return { engine, timer }
}

describe('scheduled passes', () => {
  it('a tick observes every due subject with at most two in flight, and nothing is due again until the interval passes', async () => {
    const plugins = scripted('plugin', ['a', 'b', 'c', 'd'])
    const releases = ['a', 'b', 'c', 'd'].map((id) => plugins.hold(id))
    const { engine, timer } = harness([plugins.source])
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'two subjects in flight' })
    await settleFor(40, 'the third subject must wait for a slot')
    expect(plugins.inFlight.size).toBe(2)
    for (const release of releases) release()
    await waitUntil(async () => (await engine.snapshot()).records.every((r) => r.outcome === 'current'), { label: 'every subject observed' })
    expect(plugins.maxInFlight()).toBe(2)
    expect(await engine.dueSubjects()).toEqual([])
    await waitUntil(() => !timer.running(), { label: 'pass finished' })
    await settleFor(60, 'later ticks find nothing due and start nothing')
    expect(plugins.calls.length).toBe(4)
  })

  it('a hung subject is timed out, its slot released and its failure recorded; a sibling that finishes keeps its observation', async () => {
    const plugins = scripted('plugin', ['hung', 'fine', 'after'])
    plugins.hold('hung') // never released, ignores its signal
    const { engine } = harness([plugins.source], { subjectTimeoutMs: 60 })
    await waitUntil(async () => (await engine.snapshot()).records.find((r) => r.id === 'plugin:after')?.outcome === 'current', { label: 'the subject behind the hung one still ran' })
    await waitUntil(async () => (await engine.snapshot()).records.find((r) => r.id === 'plugin:hung')?.attempt !== undefined, { label: 'the hung subject hit its deadline' })
    const hung = (await engine.snapshot()).records.find((r) => r.id === 'plugin:hung')!
    expect(hung.outcome).toBe('unknown')
    expect(hung.attempt?.error).toMatch(/timed out/)
    expect(plugins.inFlight.has('hung')).toBe(true) // the source is still stuck — only the slot was released
    expect((await engine.scheduleFor('plugin:hung'))!.failures).toBe(1)
    const fine = (await engine.snapshot()).records.find((r) => r.id === 'plugin:fine')!
    expect(fine.outcome).toBe('current')
    expect(fine.attempt?.error).toBeUndefined()
  })

  it('a source that honours its signal fails with the deadline reason through the engine', async () => {
    const plugins = scripted('plugin', ['slow'])
    plugins.hold('slow', { honourSignal: true })
    const { engine } = harness([plugins.source], { subjectTimeoutMs: 40 })
    await waitUntil(async () => (await engine.snapshot()).records[0]?.attempt?.error !== undefined, { label: 'deadline failure recorded' })
    expect((await engine.snapshot()).records[0]!.attempt?.error).toMatch(/timed out after/)
  })

  it('disabled schedules nothing; disabling mid-pass lets the running subjects finish and starts no more', async () => {
    let enabled = false
    const plugins = scripted('plugin', ['a', 'b', 'c', 'd'])
    const { engine, timer } = harness([plugins.source], { enabled: () => enabled })
    await settleFor(80, 'no scheduled pass while disabled')
    expect(plugins.calls).toEqual([])
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    enabled = true
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'pass started with two subjects' })
    enabled = false
    releaseA(); releaseB()
    await waitUntil(() => !timer.running(), { label: 'pass ended' })
    expect(plugins.calls.sort()).toEqual(['a', 'b'])
    expect((await engine.snapshot()).records.filter((r) => r.outcome === 'current').map((r) => r.id).sort()).toEqual(['plugin:a', 'plugin:b'])
  })
})

describe('check now', () => {
  it('observes every subject (not only the due ones), optionally filtered by kind or ids, even while disabled', async () => {
    const plugins = scripted('plugin', ['a', 'b'])
    const packages = scripted('package', ['p'])
    const { engine, timer } = harness([plugins.source, packages.source], { enabled: () => false, firstTickMs: 10_000 })
    await engine.ready
    const all = await timer.check()
    expect(all.ids.sort()).toEqual(['package:p', 'plugin:a', 'plugin:b'])
    expect(all.coalesced).toBe(false)
    expect((await engine.snapshot()).records.every((r) => r.outcome === 'current')).toBe(true)
    expect(await engine.dueSubjects()).toEqual([])
    const kind = await timer.check({ kind: 'package' })
    expect(kind.ids).toEqual(['package:p'])
    const ids = await timer.check({ ids: ['plugin:b'] })
    expect(ids.ids).toEqual(['plugin:b'])
    expect(plugins.calls.filter((id) => id === 'b').length).toBe(2)
    expect(packages.calls.length).toBe(2)
  })

  it('an id outside the inventory is refused with not-found before anything runs', async () => {
    const plugins = scripted('plugin', ['a'])
    const { timer } = harness([plugins.source], { firstTickMs: 10_000 })
    await expect(timer.check({ ids: ['plugin:nope'] })).rejects.toBeInstanceOf(UpdateSubjectNotFoundError)
    expect(plugins.calls).toEqual([])
  })

  it('a check during a running pass joins it: a BROAD request takes what the pass reached, an EXPLICIT id is observed again (the caller knows it changed), and both resolve when the pass ends', async () => {
    const plugins = scripted('plugin', ['a', 'b', 'c'])
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    const { engine, timer } = harness([plugins.source], { firstTickMs: 10_000 })
    await engine.ready
    const first = timer.check({ ids: ['plugin:a', 'plugin:b'] })
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'a and b in flight' })
    const broad = timer.check({ kind: 'plugin' })
    const explicit = timer.check({ ids: ['plugin:a'] })
    await settleFor(30, 'the joined checks must wait for the pass')
    expect(plugins.calls).toEqual(['a', 'b'])
    releaseA(); releaseB()
    const [one, two, three] = await Promise.all([first, broad, explicit])
    expect(one.coalesced).toBe(false)
    expect(two.coalesced).toBe(true)
    expect(three.coalesced).toBe(true)
    // c was unreached (broad queued it); a was reached but explicitly asked for again (R2 #4).
    expect(plugins.calls).toEqual(['a', 'b', 'c', 'a'])
    expect(timer.running()).toBe(false)
  })
})

describe('review round 1 — deadlines and inventory', () => {
  it('a cooperative observer records its deadline failure exactly once (no double count); a late result from a hung one is dropped (#3)', async () => {
    const plugins = scripted('plugin', ['slow', 'hung'])
    plugins.hold('slow', { honourSignal: true })
    const releaseHung = plugins.hold('hung')
    const { engine } = harness([plugins.source], { subjectTimeoutMs: 40, cancelGraceMs: 30 })
    await waitUntil(async () => {
      const { records } = await engine.snapshot()
      return records.every((r) => r.attempt?.error !== undefined)
    }, { label: 'both subjects hit their deadline' })
    await settleFor(80, 'a second failure for the same deadline would land after the grace')
    expect((await engine.scheduleFor('plugin:slow'))!.failures).toBe(1)
    expect((await engine.scheduleFor('plugin:hung'))!.failures).toBe(1)
    releaseHung() // the hung observer finally answers "current" — too late
    await settleFor(60, 'a late result must not overwrite the recorded failure')
    const hung = (await engine.snapshot()).records.find((r) => r.id === 'plugin:hung')!
    expect(hung.outcome).toBe('unknown')
    expect(hung.attempt?.error).toMatch(/timed out/)
    expect((await engine.scheduleFor('plugin:hung'))!.failures).toBe(1)
  })

  it('every pass and every explicit check refresh the inventory first: an installed subject is observed, a removed one dropped (#1)', async () => {
    const ids = ['one']
    const plugins = scripted('plugin', ids)
    const { engine, timer } = harness([plugins.source], { firstTickMs: 10_000, tickMs: 10_000 })
    await timer.check()
    expect((await engine.snapshot()).records.map((r) => r.id)).toEqual(['plugin:one'])
    ids.push('two')
    await timer.check()
    expect((await engine.snapshot()).records.map((r) => r.id).sort()).toEqual(['plugin:one', 'plugin:two'])
    expect((await engine.snapshot()).records.find((r) => r.id === 'plugin:two')!.outcome).toBe('current')
    ids.splice(0, 1)
    await timer.check({ kind: 'plugin' })
    expect((await engine.snapshot()).records.map((r) => r.id)).toEqual(['plugin:two'])
  })
})

describe('review round 2 — pass startup is serialized', () => {
  it('a tick and an explicit check that start together never run two worker pools: every subject is observed once, concurrency holds (#3)', async () => {
    const plugins = scripted('plugin', ['a', 'b', 'c', 'd'])
    let gate: Promise<void> = Promise.resolve()
    let release!: () => void
    const slowInventory: UpdateSource = { kind: 'plugin', inventory: async () => { await gate; return plugins.source.inventory() }, observe: plugins.source.observe }
    const { engine, timer } = harness([slowInventory], { firstTickMs: 10, tickMs: 10_000 })
    await engine.ready
    gate = new Promise<void>((resolve) => { release = resolve })
    await settleFor(30, 'the tick is inside its inventory refresh')
    const explicit = timer.check()
    release()
    await explicit
    await waitUntil(() => !timer.running(), { label: 'the pass ended' })
    expect([...plugins.calls].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(plugins.maxInFlight()).toBeLessThanOrEqual(2)
  })
})

describe('review round 3 — explicit work and stop', () => {
  it('a subject asked for by name is observed even when scheduled work is disabled mid-pass; a check after stop() rejects (#8)', async () => {
    const plugins = scripted('plugin', ['a', 'b', 'c', 'd'])
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    let enabled = true
    const { engine, timer } = harness([plugins.source], { enabled: () => enabled, firstTickMs: 10, tickMs: 10_000 })
    await engine.ready
    // Both workers held: c is admitted and PENDING when the disable lands (r4 review).
    await waitUntil(() => plugins.inFlight.has('a') && plugins.inFlight.has('b'), { label: 'the scheduled pass is on a and b' })
    const admitted = await timer.admit({ ids: ['plugin:c'] })
    expect(admitted.coalesced).toBe(true)
    expect(plugins.calls).not.toContain('c')
    enabled = false
    releaseA(); releaseB()
    await admitted.done
    expect(plugins.calls).toContain('c')
    // The scheduled sibling nobody asked for was dropped by the disable.
    expect(plugins.calls).not.toContain('d')
    timer.stop()
    await expect(timer.check()).rejects.toMatchObject({ name: 'UpdatesStoppedError' })
  })
})

describe('review round 4 — admission', () => {
  it('a named subject removed after admission but before its turn fails THAT check with not-found; a broad check simply no longer has it (#6)', async () => {
    const ids = ['a', 'b', 'c']
    const inventory = async () => ids.map((id): UpdateSubjectInventoryEntry => ({ subject: { kind: 'plugin', id, label: id }, group: 'available', fingerprint: fingerprintOf({ id }), source: { kind: 'scripted', endpoint: id } }))
    const plugins = scripted('plugin', ids)
    const source: UpdateSource = { ...plugins.source, inventory }
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    const { engine, timer } = harness([source], { firstTickMs: 100_000 })
    await engine.ready
    const broad = await timer.admit({ ids: ['plugin:a', 'plugin:b'] })
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'a and b in flight' })
    const named = await timer.admit({ ids: ['plugin:c'] })
    expect(named.coalesced).toBe(true)
    ids.splice(2, 1)
    await engine.refreshInventory()
    releaseA(); releaseB()
    await expect(named.done).rejects.toBeInstanceOf(UpdateSubjectNotFoundError)
    await expect(broad.done).resolves.toMatchObject({ ids: ['plugin:a', 'plugin:b'] })
    expect(plugins.calls).not.toContain('c')
  })

  it('admission validates against the inventory refreshed under the serialized startup: an unknown id rejects before any pass starts', async () => {
    const plugins = scripted('plugin', ['a'])
    const { engine, timer } = harness([plugins.source], { firstTickMs: 100_000 })
    await engine.ready
    await expect(timer.admit({ ids: ['plugin:nope'] })).rejects.toBeInstanceOf(UpdateSubjectNotFoundError)
    expect(timer.running()).toBe(false)
    expect(plugins.calls).toEqual([])
  })
})

describe('review round 5 — attempts, the deadline branch and stop', () => {
  it('a subject removed during a NON-cooperative timeout is an attempt-specific result: the pass settles normally, a broad check resolves, the named one fails, and the timer is usable after (#2)', async () => {
    const ids = ['a', 'b', 'c']
    const plugins = scripted('plugin', ids)
    const source: UpdateSource = { ...plugins.source, inventory: async () => ids.map((id): UpdateSubjectInventoryEntry => ({ subject: { kind: 'plugin', id, label: id }, group: 'available', fingerprint: fingerprintOf({ id }), source: { kind: 'scripted', endpoint: id } })) }
    plugins.hold('a') // ignores its signal — the deadline branch records the failure itself
    const { engine, timer } = harness([source], { firstTickMs: 100_000, subjectTimeoutMs: 40, cancelGraceMs: 40 })
    await engine.ready
    const named = await timer.admit({ ids: ['plugin:a'] })
    const namedOutcome = named.done.then(() => 'resolved', (err: unknown) => err) // observed now: it rejects before the test gets to it
    const broad = await timer.admit()
    await waitUntil(() => plugins.inFlight.has('a'), { label: 'a in flight' })
    // a is uninstalled while it hangs; its deadline has nowhere to land.
    ids.splice(0, 1)
    await engine.refreshInventory()
    // The pass is not rejected by that: every other subject is observed and both requests settle on their own terms.
    await expect(broad.done).resolves.toMatchObject({ coalesced: true })
    expect(await namedOutcome).toBeInstanceOf(UpdateSubjectNotFoundError)
    expect(plugins.calls.sort()).toEqual(['a', 'b', 'c'])
    expect(timer.running()).toBe(false)
    expect((await engine.snapshot()).records.map((r) => r.id).sort()).toEqual(['plugin:b', 'plugin:c'])
    // Ownership was released cleanly: the next check runs as usual.
    await expect(timer.check({ ids: ['plugin:b'] })).resolves.toMatchObject({ ids: ['plugin:b'], coalesced: false })
  })

  it('a missing subject belongs to the attempt, not the pass: remove → missing for A, reinstall → a fresh attempt for B succeeds while the same pass is alive (#5)', async () => {
    const ids = ['a', 'b', 'c']
    const plugins = scripted('plugin', ids)
    const source: UpdateSource = { ...plugins.source, inventory: async () => ids.map((id): UpdateSubjectInventoryEntry => ({ subject: { kind: 'plugin', id, label: id }, group: 'available', fingerprint: fingerprintOf({ id }), source: { kind: 'scripted', endpoint: id } })) }
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    const { engine, timer } = harness([source], { firstTickMs: 100_000 })
    await engine.ready
    await timer.admit({ ids: ['plugin:a', 'plugin:b'] })
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'a and b in flight' })
    const requestA = await timer.admit({ ids: ['plugin:c'] })
    const outcomeA = requestA.done.then(() => 'resolved', (err: unknown) => err)
    ids.splice(2, 1)
    await engine.refreshInventory()
    releaseA() // the free worker takes c: gone
    await waitUntil(() => plugins.calls.filter((id) => id === 'a').length === 1 && !plugins.inFlight.has('a'), { label: 'a settled' })
    await settleFor(30, 'the c attempt is refused by the engine (never observed)')
    expect(plugins.calls).not.toContain('c')
    // c comes back; B asks for it — a NEW attempt, unaffected by A's.
    ids.push('c')
    await engine.refreshInventory()
    const requestB = await timer.admit({ ids: ['plugin:c'] })
    expect(requestB.coalesced).toBe(true)
    releaseB() // the slot b held takes B's attempt for c — the same pass
    await waitUntil(() => plugins.calls.includes('c'), { label: 'c observed for B' })
    await expect(requestB.done).resolves.toMatchObject({ ids: ['plugin:c'] })
    expect(await outcomeA).toBeInstanceOf(UpdateSubjectNotFoundError)
  })

  it('a stop that lands while the admission refresh is in flight refuses the admission — never an accepted check nobody will run (#6)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let held = false
    const plugins = scripted('plugin', ['a'])
    const inner = plugins.source.inventory
    const source: UpdateSource = { ...plugins.source, inventory: async () => { if (held) await gate; return inner() } }
    const { engine, timer } = harness([source], { firstTickMs: 100_000 })
    await engine.ready
    held = true
    const admission = timer.admit()
    await settleFor(20, 'the admission is inside the held refresh')
    timer.stop()
    release()
    await expect(admission).rejects.toMatchObject({ name: 'UpdatesStoppedError' })
    expect(timer.running()).toBe(false)
    expect(plugins.calls).toEqual([])
  })
})

describe('review round 6 — duplicate ids', () => {
  it('a repeated id is ONE attempt: one observation, one result, never two workers superseding each other (#4)', async () => {
    const plugins = scripted('plugin', ['a', 'b'])
    const { engine, timer } = harness([plugins.source], { firstTickMs: 100_000 })
    await engine.ready
    const run = await timer.check({ ids: ['plugin:a', 'plugin:a'] })
    expect(run.ids).toEqual(['plugin:a'])
    expect(plugins.calls).toEqual(['a'])
    expect(plugins.maxInFlight()).toBe(1)
    expect((await engine.snapshot()).records.find((r) => r.id === 'plugin:a')?.outcome).toBe('current')
  })
})

describe('review round 7 — one attempt per subject at a time', () => {
  it('a repeat attempt for a subject still in flight waits for it: the first result is kept, the repeat runs after (#3)', async () => {
    const plugins = scripted('plugin', ['a', 'b'])
    const releaseA = plugins.hold('a')
    const releaseB = plugins.hold('b')
    const { engine, timer } = harness([plugins.source], { firstTickMs: 100_000 })
    await engine.ready
    const first = await timer.admit({ ids: ['plugin:a', 'plugin:b'] })
    await waitUntil(() => plugins.inFlight.size === 2, { label: 'a and b in flight' })
    const repeat = await timer.admit({ ids: ['plugin:a'] })
    expect(repeat.coalesced).toBe(true)
    // b's worker frees up and takes the queued a — but a is still active, so it waits.
    releaseB()
    await waitUntil(() => !plugins.inFlight.has('b'), { label: 'b settled' })
    await settleFor(40, 'the repeat attempt for a must not start while the first is in flight')
    expect(plugins.calls.filter((id) => id === 'a')).toEqual(['a'])
    expect(plugins.inFlight.size).toBe(1)
    releaseA()
    await expect(first.done).resolves.toMatchObject({ ids: ['plugin:a', 'plugin:b'] })
    await expect(repeat.done).resolves.toMatchObject({ ids: ['plugin:a'] })
    expect(plugins.calls.filter((id) => id === 'a')).toEqual(['a', 'a'])
    expect(plugins.maxInFlight()).toBe(2)
    expect((await engine.snapshot()).records.find((r) => r.id === 'plugin:a')?.outcome).toBe('current')
  })
})
