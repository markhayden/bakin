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

import { observeInstalledPackage, PackageNotTrackedError } from '../../../src/core/updates/observe'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import { getUpdatesEngine, registerUpdateSource, resetUpdateSources, startUpdates, stopUpdates, UPDATES_FILE_NAME } from '../../../src/core/updates/service'
import type { UpdateObservation, UpdateSource } from '../../../src/core/updates/types'
import { writeLockfile } from '../../../packages/core/src/agent-packages/lockfile'

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
