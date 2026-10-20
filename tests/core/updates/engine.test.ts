/**
 * The updates engine: boot reconciliation behind a read barrier, two clocks
 * (last successful observation vs last attempt), stale-fingerprint drops,
 * backoff bookkeeping, and identity-keyed skips (#1007, D7.2/D7.3).
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-engine-${Date.now()}-${randomUUID()}`)
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

import { countAvailableUpdates, isUpdateSkipped, type UpdateRecord } from '@makinbakin/sdk/types'
import { createUpdatesEngine, UpdateSubjectNotFoundError, type UpdatesEngine } from '../../../src/core/updates/engine'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import { readUpdatesFile, writeUpdatesFile, emptyUpdatesFile } from '../../../src/core/updates/store'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../../../src/core/updates/types'
import { settleFor } from '../../helpers/wait'

const HOUR = 3_600_000
const T0 = Date.parse('2026-10-20T12:00:00.000Z')

/** A scripted source: inventory + per-subject observation outcomes the test controls. */
function scripted(kind: UpdateSource['kind'], subjects: Array<{ id: string; fingerprint?: string; group?: 'required' | 'available' }>) {
  const observations = new Map<string, () => Promise<UpdateObservation>>()
  const calls: string[] = []
  let gate: Promise<void> = Promise.resolve()
  const source: UpdateSource = {
    kind,
    inventory: async () => {
      await gate
      return subjects.map((subject): UpdateSubjectInventoryEntry => ({
        subject: { kind, id: subject.id, label: subject.id },
        group: subject.group ?? 'available',
        fingerprint: subject.fingerprint ?? fingerprintOf({ id: subject.id, v: 1 }),
        source: { kind: 'scripted', endpoint: `scripted://${subject.id}` },
      }))
    },
    observe: async (entry) => {
      calls.push(entry.subject.id)
      const script = observations.get(entry.subject.id)
      if (!script) throw new Error(`no script for ${entry.subject.id}`)
      return script()
    },
  }
  return {
    source,
    calls,
    when: (id: string, script: () => Promise<UpdateObservation>) => { observations.set(id, script) },
    holdInventory: () => { let release!: () => void; gate = new Promise<void>((resolve) => { release = resolve }); return release },
    setFingerprint: (id: string, fingerprint: string) => { const s = subjects.find((x) => x.id === id)!; s.fingerprint = fingerprint },
    remove: (id: string) => { subjects.splice(subjects.findIndex((x) => x.id === id), 1) },
  }
}

const available = (version: string, sha?: string): UpdateObservation => ({
  installed: { version: '1.0.0', display: '1.0.0' },
  available: { version, sha, display: version },
  reason: 'newer-version',
  outcome: 'update-available',
  action: { kind: 'operation', start: { route: '/api/x' }, impact: ['download'] },
})
const current: UpdateObservation = { installed: { version: '1.0.0', display: '1.0.0' }, outcome: 'current' }

let now = T0
const engines: UpdatesEngine[] = []
function boot(sources: UpdateSource[], opts: { published?: Array<{ type: string; ids: string[] }>; path?: string; intervalMs?: number } = {}): UpdatesEngine {
  const engine = createUpdatesEngine({
    storePath: opts.path ?? join(testDir, `${randomUUID()}.json`),
    sources,
    now: () => now,
    intervalMs: opts.intervalMs ?? 6 * HOUR,
    publish: (event) => opts.published?.push(event),
  })
  engines.push(engine)
  return engine
}
afterEach(() => { now = T0; engines.length = 0 })

describe('boot reconciliation', () => {
  it('an empty store yields one unknown, due-now record per inventory subject', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }, { id: 'terminal' }])
    const engine = boot([plugins.source])
    const snapshot = await engine.snapshot()
    expect(snapshot.records.map((r) => [r.id, r.outcome, r.observedAt, r.attempt])).toEqual([
      ['plugin:projects', 'unknown', undefined, undefined],
      ['plugin:terminal', 'unknown', undefined, undefined],
    ])
    expect(await engine.dueSubjects()).toEqual(['plugin:projects', 'plugin:terminal'])
  })

  it('a persisted record whose fingerprint still matches is served as persisted; a stale one is unknown with "inventory changed" and due now; a vanished subject is dropped', async () => {
    const path = join(testDir, 'persisted.json')
    const fp = fingerprintOf({ id: 'projects', v: 1 })
    const good: UpdateRecord = {
      id: 'plugin:projects', group: 'available', subject: { kind: 'plugin', id: 'projects', label: 'projects' },
      installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version',
      outcome: 'update-available', source: { kind: 'scripted', endpoint: 'scripted://projects' },
      observedAt: '2026-10-20T10:00:00.000Z', attempt: { at: '2026-10-20T10:00:00.000Z' }, fingerprint: fp,
      action: { kind: 'operation', start: { route: '/api/x' }, impact: ['download'] },
    }
    const stale: UpdateRecord = { ...good, id: 'plugin:terminal', subject: { kind: 'plugin', id: 'terminal', label: 'terminal' }, fingerprint: 'old-fingerprint' }
    const gone: UpdateRecord = { ...good, id: 'plugin:gone', subject: { kind: 'plugin', id: 'gone', label: 'gone' } }
    writeUpdatesFile(path, {
      ...emptyUpdatesFile(),
      records: { [good.id]: good, [stale.id]: stale, [gone.id]: gone },
      schedule: { [good.id]: { lastCheckedAt: good.observedAt, nextDueAt: '2026-10-20T16:00:00.000Z', failures: 0 }, [stale.id]: { lastCheckedAt: good.observedAt, nextDueAt: '2026-10-20T16:00:00.000Z', failures: 0 } },
    })
    const plugins = scripted('plugin', [{ id: 'projects' }, { id: 'terminal' }])
    const engine = boot([plugins.source], { path })
    const { records } = await engine.snapshot()
    expect(records.find((r) => r.id === 'plugin:projects')).toEqual(good)
    const terminal = records.find((r) => r.id === 'plugin:terminal')!
    expect(terminal.outcome).toBe('unknown')
    expect(terminal.attempt).toEqual({ at: new Date(T0).toISOString(), error: 'inventory changed' })
    expect(terminal.observedAt).toBeUndefined()
    expect(terminal.available).toBeUndefined()
    expect(terminal.fingerprint).toBe(fingerprintOf({ id: 'terminal', v: 1 }))
    expect(records.some((r) => r.id === 'plugin:gone')).toBe(false)
    expect(await engine.dueSubjects()).toEqual(['plugin:terminal'])
    // Reconciliation is persisted, so a restart does not redo it.
    expect(Object.keys(readUpdatesFile(path)!.records).sort()).toEqual(['plugin:projects', 'plugin:terminal'])
  })

  it('a read during startup waits for reconciliation — it never serves a stale record', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }])
    const release = plugins.holdInventory()
    const engine = boot([plugins.source])
    let served: UpdateRecord[] | null = null
    const read = engine.snapshot().then((snapshot) => { served = snapshot.records })
    await settleFor(50, 'the read must stay pending while the inventory is held')
    expect(served).toBeNull()
    release()
    await read
    expect(served!.map((r) => r.id)).toEqual(['plugin:projects'])
  })
})

describe('observations and the two clocks', () => {
  it('a successful observation sets observedAt and attempt, persists, publishes, and schedules the next check one interval out', async () => {
    const published: Array<{ type: string; ids: string[] }> = []
    const path = join(testDir, 'observe.json')
    const plugins = scripted('plugin', [{ id: 'projects' }])
    plugins.when('projects', async () => available('1.1.0'))
    const engine = boot([plugins.source], { published, path })
    now = T0 + 1_000
    const record = await engine.observe('plugin:projects')
    expect(record.outcome).toBe('update-available')
    expect(record.observedAt).toBe(new Date(now).toISOString())
    expect(record.attempt).toEqual({ at: new Date(now).toISOString() })
    expect(published).toEqual([{ type: 'updates.changed', ids: ['plugin:projects'] }])
    const file = readUpdatesFile(path)!
    expect(file.records['plugin:projects']!.available?.version).toBe('1.1.0')
    expect(file.schedule['plugin:projects']).toEqual({ lastCheckedAt: new Date(now).toISOString(), nextDueAt: new Date(now + 6 * HOUR).toISOString(), failures: 0 })
    expect(await engine.dueSubjects()).toEqual([])
    now = T0 + 6 * HOUR + 2_000
    expect(await engine.dueSubjects()).toEqual(['plugin:projects'])
  })

  it('a failed attempt keeps the last good observation, records the error on attempt, and backs off doubling to 24 h', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }])
    plugins.when('projects', async () => available('1.1.0'))
    const engine = boot([plugins.source])
    await engine.observe('plugin:projects')
    const goodAt = new Date(now).toISOString()
    plugins.when('projects', async () => { throw new Error('rate limited') })
    const dues: number[] = []
    for (let i = 0; i < 8; i++) {
      now += 1_000
      const record = await engine.observe('plugin:projects')
      expect(record.outcome).toBe('update-available')
      expect(record.available?.version).toBe('1.1.0')
      expect(record.observedAt).toBe(goodAt)
      expect(record.attempt).toEqual({ at: new Date(now).toISOString(), error: 'rate limited' })
      dues.push(Date.parse((await engine.scheduleFor('plugin:projects'))!.nextDueAt!) - now)
    }
    expect(dues.slice(0, 4)).toEqual([15 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000])
    expect(dues[dues.length - 1]).toBe(24 * HOUR)
    expect((await engine.scheduleFor('plugin:projects'))!.failures).toBe(8)
    // A success resets the backoff.
    plugins.when('projects', async () => available('1.1.0'))
    now += 1_000
    await engine.observe('plugin:projects')
    expect((await engine.scheduleFor('plugin:projects'))!.failures).toBe(0)
  })

  it('a subject with no success yet is unknown with the error — never a fabricated observation', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }])
    plugins.when('projects', async () => { throw new Error('offline') })
    const engine = boot([plugins.source])
    const record = await engine.observe('plugin:projects')
    expect(record.outcome).toBe('unknown')
    expect(record.observedAt).toBeUndefined()
    expect(record.attempt?.error).toBe('offline')
    expect(record.available).toBeUndefined()
  })

  it('an observation that lands after the subject\'s fingerprint changed is dropped and the record goes unknown', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }])
    let resolveObservation!: (value: UpdateObservation) => void
    plugins.when('projects', () => new Promise<UpdateObservation>((resolve) => { resolveObservation = resolve }))
    const engine = boot([plugins.source])
    const pending = engine.observe('plugin:projects')
    await settleFor(10, 'let the observation start against the old fingerprint')
    plugins.setFingerprint('projects', 'new-fingerprint')
    await engine.refreshInventory()
    resolveObservation(available('9.9.9'))
    const record = await pending
    expect(record.outcome).toBe('unknown')
    expect(record.available).toBeUndefined()
    expect(record.fingerprint).toBe('new-fingerprint')
    expect(record.attempt?.error).toBe('inventory changed')
  })

  it('observing an id that is not in the inventory is a not-found error', async () => {
    const engine = boot([scripted('plugin', [{ id: 'projects' }]).source])
    await expect(engine.observe('plugin:nope')).rejects.toBeInstanceOf(UpdateSubjectNotFoundError)
    await expect(engine.skip('plugin:nope')).rejects.toBeInstanceOf(UpdateSubjectNotFoundError)
  })
})

describe('skips', () => {
  it('skipping hides the current available identity, drops it from the count, and a new identity clears the skip — two same-version commits are two skips', async () => {
    const published: Array<{ type: string; ids: string[] }> = []
    const plugins = scripted('plugin', [{ id: 'projects' }])
    plugins.when('projects', async () => available('1.1.0', 'aaa'))
    const engine = boot([plugins.source], { published })
    await engine.observe('plugin:projects')
    expect(countAvailableUpdates((await engine.snapshot()).records)).toBe(1)

    const skipped = await engine.skip('plugin:projects')
    expect(skipped.skipped).toEqual({ version: '1.1.0', sha: 'aaa' })
    expect(isUpdateSkipped(skipped)).toBe(true)
    expect(countAvailableUpdates((await engine.snapshot()).records)).toBe(0)
    expect(published.at(-1)).toEqual({ type: 'updates.changed', ids: ['plugin:projects'] })

    // Same version, different commit: a distinct identity — offered again.
    plugins.when('projects', async () => available('1.1.0', 'bbb'))
    const again = await engine.observe('plugin:projects')
    expect(again.skipped).toBeUndefined()
    expect(countAvailableUpdates([again])).toBe(1)

    // Re-observing the identical identity keeps a skip in place.
    await engine.skip('plugin:projects')
    const same = await engine.observe('plugin:projects')
    expect(isUpdateSkipped(same)).toBe(true)
  })

  it('skipping a record with nothing available is refused', async () => {
    const plugins = scripted('plugin', [{ id: 'projects' }])
    plugins.when('projects', async () => current)
    const engine = boot([plugins.source])
    await engine.observe('plugin:projects')
    await expect(engine.skip('plugin:projects')).rejects.toThrow(/nothing to skip/)
  })
})
