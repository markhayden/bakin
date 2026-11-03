/**
 * The in-process observer entry (#1007 B 8.4): `sync --check` asks it
 * instead of probing. With an engine running it rides the timer's admission
 * and answers with the fresh record; without one the package sources observe
 * directly and nothing is persisted.
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-observe-${Date.now()}-${randomUUID()}`)
mkdirSync(join(testDir, 'packages'), { recursive: true })
process.env.BAKIN_HOME = testDir
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
mock.module('../../../src/core/sse', () => ({ broadcast: () => {} }))

import { observeInstalledPackage, PackageNotTrackedError, PackageSupersededError } from '../../../src/core/updates/observe'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import { getUpdatesEngine, getUpdatesTimer, registerUpdateSource, resetUpdateSources, startUpdates, stopUpdates, UPDATES_FILE_NAME } from '../../../src/core/updates/service'
import type { UpdateObservation, UpdateSource } from '../../../src/core/updates/types'
import { readLockfile, writeLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })
afterEach(() => { stopUpdates(); resetUpdateSources() })

/** A local-path package: the lockfile entry points at a directory whose manifest carries `sourceVersion`. */
function seedLocalPackage(id: string, installedVersion: string, sourceVersion: string): string {
  const src = join(testDir, 'sources', `${id}-${randomUUID()}`)
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'bakin-package.json'), JSON.stringify({ id, version: sourceVersion, kind: 'skill-pack', name: id, description: 'x', contributions: { skills: ['research'] } }))
  writeLockfile({
    version: 1,
    packages: {
      [`${id}@${installedVersion}`]: { kind: 'skill-pack', version: installedVersion, source: src, ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z' },
    },
  })
  return src
}

describe('observeInstalledPackage without an engine', () => {
  it('observes a local-path package directly — newer source version offered, same version current — by key or id', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.1.0')
    const byKey = await observeInstalledPackage('editorial@1.0.0')
    expect(byKey.outcome).toBe('update-available')
    expect(byKey.available?.version).toBe('1.1.0')
    expect(byKey.reason).toBe('newer-version')
    const byId = await observeInstalledPackage('editorial')
    expect(byId.outcome).toBe('update-available')

    seedLocalPackage('editorial', '1.1.0', '1.1.0')
    expect((await observeInstalledPackage('editorial')).outcome).toBe('current')
    // Nothing was persisted: no engine, no updates file.
    expect(existsSync(join(testDir, UPDATES_FILE_NAME))).toBe(false)
  })

  it('a source directory that vanished is blocked, with the reason', async () => {
    const src = seedLocalPackage('editorial', '1.0.0', '1.0.0')
    rmSync(src, { recursive: true, force: true })
    const observed = await observeInstalledPackage('editorial')
    expect(observed.outcome).toBe('blocked')
    expect(observed.blockedReason).toContain('source path missing')
  })

  it('review r2 #4: an exact key that is not the newest install is refused — never silently answered with the newer install\'s verdict', async () => {
    const older = join(testDir, 'sources', `editorial-old-${randomUUID()}`)
    const newer = join(testDir, 'sources', `editorial-new-${randomUUID()}`)
    for (const [dir, version] of [[older, '1.5.0'], [newer, '2.0.0']] as const) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({ id: 'editorial', version, kind: 'skill-pack', name: 'editorial', description: 'x', contributions: { skills: ['research'] } }))
    }
    writeLockfile({
      version: 1,
      packages: {
        'editorial@1.0.0': { kind: 'skill-pack', version: '1.0.0', source: older, ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z' },
        'editorial@2.0.0': { kind: 'skill-pack', version: '2.0.0', source: newer, ref: '', commitSha: '', installedAt: '2026-10-15T00:00:00.000Z' },
      },
    })
    await expect(observeInstalledPackage('editorial@1.0.0')).rejects.toBeInstanceOf(PackageSupersededError)
    await expect(observeInstalledPackage('editorial@1.0.0')).rejects.toThrow('superseded by "editorial@2.0.0"')
    // The canonical key and the bare id observe the NEWER install's source.
    expect((await observeInstalledPackage('editorial@2.0.0')).outcome).toBe('current')
    expect((await observeInstalledPackage('editorial')).outcome).toBe('current')
  })

  it('an id the lockfile does not hold is refused, never "current"', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    await expect(observeInstalledPackage('ghost')).rejects.toBeInstanceOf(PackageNotTrackedError)
  })
})

describe('observeInstalledPackage with the engine running', () => {
  function scripted(observe: () => Promise<UpdateObservation>) {
    const calls: string[] = []
    const source: UpdateSource = {
      kind: 'package',
      inventory: async () => [{ subject: { kind: 'package', id: 'editorial', label: 'editorial' }, group: 'available', fingerprint: fingerprintOf({ id: 'editorial' }), source: { kind: 's', endpoint: 'editorial' } }],
      observe: async (entry) => { calls.push(entry.subject.id); return observe() },
    }
    return { source, calls }
  }

  it('rides the engine: the source observes once through the timer and the recorded answer comes back', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    const script = scripted(async () => ({ installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '2.0.0', sha: 'b'.repeat(40), display: '2.0.0' }, reason: 'newer-version', outcome: 'update-available' }))
    registerUpdateSource(script.source)
    startUpdates(testDir)

    const observed = await observeInstalledPackage('editorial@1.0.0')
    expect(script.calls).toEqual(['editorial'])
    expect(observed.outcome).toBe('update-available')
    expect(observed.available?.version).toBe('2.0.0')
    // The engine recorded it — Team/Explore/Health read the same answer.
    const record = (await getUpdatesEngine()!.snapshot()).records.find((r) => r.id === 'package:editorial')
    expect(record?.outcome).toBe('update-available')
    expect(record?.observedAt).toBeDefined()
  })

  it('review r1 #2: a sibling that re-observes the package successfully before our admission settles never changes THIS check\'s answer — the attempt result, not the snapshot', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    let fail = true
    const script = scripted(async () => {
      if (fail) { fail = false; throw new Error('ls-remote: offline') }
      return { installed: { version: '1.0.0', display: '1.0.0' }, outcome: 'current' }
    })
    registerUpdateSource(script.source)
    startUpdates(testDir)
    const engine = getUpdatesEngine()!
    const timer = getUpdatesTimer()!
    // Between our attempt settling and our admission's `done` resolving, another request re-observes the subject (the pass is still open for it).
    const realAdmit = timer.admit
    timer.admit = async (request) => {
      const admitted = await realAdmit(request)
      return { ...admitted, done: admitted.done.then(async (run) => { await engine.observe('package:editorial'); return run }) }
    }
    await expect(observeInstalledPackage('editorial')).rejects.toThrow('ls-remote: offline')
    expect(script.calls).toEqual(['editorial', 'editorial'])
    expect((await engine.snapshot()).records.find((r) => r.id === 'package:editorial')?.outcome).toBe('current')
  })

  it('review r3 #5: an install superseded WHILE the check waited is refused — the observation is the newer install\'s, never substituted', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    const script = scripted(async () => ({ installed: { version: '2.0.0', display: '2.0.0' }, outcome: 'current' }))
    registerUpdateSource(script.source)
    startUpdates(testDir)
    const timer = getUpdatesTimer()!
    const realAdmit = timer.admit
    timer.admit = async (request) => {
      const admitted = await realAdmit(request)
      // Between admission and the answer, a newer install of the same id lands under another key.
      return { ...admitted, done: admitted.done.then((run) => { seedLocalPackage('editorial', '2.0.0', '2.0.0'); return run }) }
    }
    await expect(observeInstalledPackage('editorial@1.0.0')).rejects.toBeInstanceOf(PackageSupersededError)
  })

  it('review r4 #2: a hub skill\'s observation names the HUB\'s resolved version, not the frontmatter version — the guard compares the identity the source names', async () => {
    // A github hub skill tracking `main`, frontmatter version 1.0.0, hub ref "main" — and a ClawHub one resolved to 2.3.0 with frontmatter 1.0.0.
    const skill = (id: string, source: string, upstream: { source: string; ref?: string; resolvedSha?: string }) => {
      const dir = getPackageSourceDir(testDir, 'skill-pack', id, '1.0.0')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({ id, version: '1.0.0', kind: 'skill-pack', name: id, description: 'x', contributions: { skills: ['x'] }, upstream }))
      return { kind: 'skill-pack' as const, version: '1.0.0', source, ref: source.startsWith('github:') ? 'main' : '', commitSha: source.startsWith('github:') ? SHA_A : '', installedAt: '2026-10-01T00:00:00.000Z' }
    }
    writeLockfile({ version: 1, packages: {
      'hub-tools@1.0.0': skill('hub-tools', 'github:acme/skills#tools', { source: 'github:acme/skills#tools', ref: 'main', resolvedSha: SHA_A }),
      'hub-weather@1.0.0': skill('hub-weather', 'clawhub:weather', { source: 'clawhub:weather', ref: '2.3.0' }),
    } })
    const hub: UpdateSource = {
      kind: 'hub-skill',
      inventory: async () => ['hub-tools', 'hub-weather'].map((id) => ({ subject: { kind: 'hub-skill' as const, id, label: id }, group: 'available' as const, fingerprint: fingerprintOf({ id }), source: { kind: 's', endpoint: id } })),
      observe: async (entry) => (entry.subject.id === 'hub-tools'
        ? { installed: { version: 'main', sha: SHA_A, display: 'main' }, outcome: 'current' }
        : { installed: { version: '2.3.0', display: '2.3.0' }, available: { version: '2.4.0', display: '2.4.0' }, reason: 'newer-version', outcome: 'update-available' }),
    }
    registerUpdateSource(hub)
    startUpdates(testDir)
    expect((await observeInstalledPackage('hub-tools')).outcome).toBe('current')
    expect((await observeInstalledPackage('hub-weather@1.0.0')).outcome).toBe('update-available')

    // r5 #4: a ClawHub sync while the check waited moved ONLY the hub's resolved version (same key, same frontmatter
    // version, empty commit, same instant) — a supersession, refused.
    const timer = getUpdatesTimer()!
    const realAdmit = timer.admit
    timer.admit = async (request) => {
      const admitted = await realAdmit(request)
      return { ...admitted, done: admitted.done.then((run) => {
        const dir = getPackageSourceDir(testDir, 'skill-pack', 'hub-weather', '1.0.0')
        writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({ id: 'hub-weather', version: '1.0.0', kind: 'skill-pack', name: 'hub-weather', description: 'x', contributions: { skills: ['x'] }, upstream: { source: 'clawhub:weather', ref: '2.4.0' } }))
        return run
      }) }
    }
    await expect(observeInstalledPackage('hub-weather@1.0.0')).rejects.toBeInstanceOf(PackageSupersededError)
  })

  it('review r4 #3: a re-install under the SAME key while the check waited (new commit, new instant) is refused too', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    const script = scripted(async () => ({ installed: { version: '1.0.0', display: '1.0.0' }, outcome: 'current' }))
    registerUpdateSource(script.source)
    startUpdates(testDir)
    const timer = getUpdatesTimer()!
    const realAdmit = timer.admit
    timer.admit = async (request) => {
      const admitted = await realAdmit(request)
      return { ...admitted, done: admitted.done.then((run) => {
        const lock = readLockfile()
        const entry = lock.packages['editorial@1.0.0']!
        writeLockfile({ ...lock, packages: { 'editorial@1.0.0': { ...entry, commitSha: SHA_B, installedAt: '2026-10-21T00:00:00.000Z' } } })
        return run
      }) }
    }
    await expect(observeInstalledPackage('editorial@1.0.0')).rejects.toBeInstanceOf(PackageSupersededError)
  })

  it('a failed observation is this check\'s failure, even over an earlier good record', async () => {
    seedLocalPackage('editorial', '1.0.0', '1.0.0')
    let fail = false
    const script = scripted(async () => {
      if (fail) throw new Error('ls-remote: offline')
      return { installed: { version: '1.0.0', display: '1.0.0' }, outcome: 'current' }
    })
    registerUpdateSource(script.source)
    startUpdates(testDir)

    expect((await observeInstalledPackage('editorial')).outcome).toBe('current')
    fail = true
    await expect(observeInstalledPackage('editorial')).rejects.toThrow('ls-remote: offline')
    // The last good observation survives on the record (two clocks).
    const record = (await getUpdatesEngine()!.snapshot()).records.find((r) => r.id === 'package:editorial')
    expect(record?.outcome).toBe('current')
    expect(record?.attempt?.error).toBe('ls-remote: offline')
  })
})
