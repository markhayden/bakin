/**
 * Pure install-state join tests: catalog entries × lockfiles.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-explore-join-${Date.now()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { joinInstallState, updateAvailableOf, updateStateOf } from '../../../plugins/explore/lib/install-state'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { InstallStateSources, UpdateRecordMap } from '../../../plugins/explore/lib/install-state'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { canonicalPackageEntries, type Lockfile } from '../../../packages/core/src/agent-packages/lockfile'
import type { InstalledPackage } from '../../../src/core/updates/sources/package'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const entry = (overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'kind'>): CatalogEntry => ({
  name: overrides.id,
  description: 'x',
  runtimes: ['*'],
  category: 'Test',
  tags: [],
  useCases: [],
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  screenshots: [],
  source: overrides.builtin ? undefined : `github:markhayden/bakin-bits-official#x/${overrides.id}`,
  ...overrides,
})

/** Sources from a lockfile: the canonical installed packages with no hub provenance unless `upstreams` names some. */
const sources = (over: Partial<Omit<InstallStateSources, 'packages'>> & { packageLock?: Lockfile; upstreams?: Record<string, InstalledPackage['upstream']> } = {}): InstallStateSources => {
  const { packageLock, upstreams, ...rest } = over
  return {
    pluginLock: { version: 1, plugins: {} },
    packages: canonicalPackageEntries(packageLock ?? { version: 1, packages: {} }).map((c) => ({ ...c, upstream: upstreams?.[c.id] ?? null })),
    installedPluginDirs: new Set<string>(),
    ...rest,
  }
}

const record = (over: Partial<UpdateRecord> & Pick<UpdateRecord, 'id' | 'outcome'>): UpdateRecord => ({
  group: 'available',
  subject: { kind: over.id.slice(0, over.id.indexOf(':')) as UpdateRecord['subject']['kind'], id: over.id.slice(over.id.indexOf(':') + 1), label: over.id },
  source: { kind: 'fixture', endpoint: 'fixture' },
  fingerprint: 'fp',
  ...over,
})
const recordMap = (records: UpdateRecord[]): UpdateRecordMap => new Map(records.map((r) => [r.id, r]))

const pluginEntry = (over: Record<string, unknown> = {}) => ({
  type: 'github' as const,
  source: 'github:markhayden/bakin-bits-official#plugins/messaging',
  ref: 'main',
  commitSha: SHA_A,
  version: '1.0.0',
  permissions: [],
  manifestSha: 'sha',
  installedAt: '2026-07-01T00:00:00Z',
  ...over,
})

describe('joinInstallState', () => {
  it('builtin entries are always installed with unknown update state', () => {
    const [joined] = joinInstallState([entry({ id: 'team', kind: 'plugin', builtin: true })], sources())
    expect(joined).toMatchObject({ installed: true, updateAvailable: null, installedVersion: null })
  })

  it('agents join against agent-kind lockfile entries by agentId', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'pixel@1.2.0': {
            kind: 'agent', version: '1.2.0', source: 'github:x#agents/pixel',
            ref: 'main', commitSha: SHA_A, installedAt: 'now', agentId: 'pixel', state: 'managed',
          },
        },
      } as Lockfile,
    })
    const [installed, absent] = joinInstallState(
      [entry({ id: 'pixel', kind: 'agent' }), entry({ id: 'rolo', kind: 'agent' })],
      src,
    )
    expect(installed).toMatchObject({ installed: true, installedVersion: '1.2.0', updateAvailable: null })
    expect(absent).toMatchObject({ installed: false, installedVersion: null, updateAvailable: null })
  })

  it('plugins project the engine record for plugin:<id> — offered, current, skipped, unknown, none', () => {
    const src = sources({
      pluginLock: {
        version: 1,
        plugins: {
          fresh: pluginEntry(),
          stale: pluginEntry(),
          hidden: pluginEntry(),
          unseen: pluginEntry(),
          unobserved: pluginEntry(),
        },
      } as InstallStateSources['pluginLock'],
    })
    const records = recordMap([
      record({ id: 'plugin:fresh', outcome: 'current' }),
      record({ id: 'plugin:stale', outcome: 'update-available', available: { version: '1.1.0', sha: SHA_B, display: '1.1.0' } }),
      record({ id: 'plugin:hidden', outcome: 'update-available', available: { version: '1.1.0', sha: SHA_B, display: '1.1.0' }, skipped: { version: '1.1.0', sha: SHA_B } }),
      record({ id: 'plugin:unseen', outcome: 'unknown', attempt: { at: 'now', error: 'offline' } }),
    ])
    const [fresh, stale, hidden, unseen, unobserved, absent] = joinInstallState(
      [
        entry({ id: 'fresh', kind: 'plugin' }),
        entry({ id: 'stale', kind: 'plugin' }),
        entry({ id: 'hidden', kind: 'plugin' }),
        entry({ id: 'unseen', kind: 'plugin' }),
        entry({ id: 'unobserved', kind: 'plugin' }),
        entry({ id: 'absent', kind: 'plugin' }),
      ],
      src,
      records,
    )
    expect(fresh).toMatchObject({ installed: true, updateAvailable: false, installedVersion: '1.0.0' })
    expect(stale).toMatchObject({ installed: true, updateAvailable: true })
    expect(hidden).toMatchObject({ installed: true, updateAvailable: false })
    expect(unseen).toMatchObject({ installed: true, updateAvailable: null })
    expect(unobserved).toMatchObject({ installed: true, updateAvailable: null })
    expect(absent).toMatchObject({ installed: false, updateAvailable: null })
  })

  it('agents and packs find their record by the lockfile key id — `package:` for a package, `hub-skill:` for one with hub provenance', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'pixel@1.2.0': { kind: 'agent', version: '1.2.0', source: 'github:x/pixel', ref: 'main', commitSha: SHA_A, installedAt: 'now', agentId: 'pixel', state: 'managed' },
          'editorial@1.0.0': { kind: 'skill-pack', version: '1.0.0', source: 'github:x/editorial', ref: 'main', commitSha: SHA_A, installedAt: 'now' },
          'hub-weather@0.3.0': { kind: 'skill-pack', version: '0.3.0', source: 'clawhub:weather', ref: '', commitSha: '', installedAt: 'now' },
        },
      } as unknown as Lockfile,
    })
    src.packages = src.packages.map((pkg) => (pkg.id === 'hub-weather' ? { ...pkg, upstream: { source: 'clawhub:weather', ref: '0.3.0' } } : pkg))
    const records = recordMap([
      record({ id: 'package:pixel', outcome: 'update-available', available: { version: '1.3.0', sha: SHA_B, display: '1.3.0' } }),
      record({ id: 'package:editorial', outcome: 'current' }),
      record({ id: 'hub-skill:hub-weather', outcome: 'update-available', installed: { version: '0.3.0', display: '0.3.0' }, available: { version: '0.4.0', display: '0.4.0' } }),
    ])
    const [pixel, editorial, weather] = joinInstallState(
      [
        entry({ id: 'pixel', kind: 'agent' }),
        entry({ id: 'editorial', kind: 'skill-pack' }),
        entry({ id: 'hub-weather', kind: 'skill-pack' }),
      ],
      src,
      records,
    )
    expect(pixel).toMatchObject({ installed: true, updateAvailable: true, installedVersion: '1.2.0' })
    expect(editorial).toMatchObject({ installed: true, updateAvailable: false, installedVersion: '1.0.0' })
    expect(weather).toMatchObject({ installed: true, updateAvailable: true, installedVersion: '0.3.0' })
  })

  it('review r1 #6: a superseded key still present never joins — the canonical (newest installed) entry carries the version AND the record, in both insertion orders', () => {
    const v1 = { kind: 'agent', version: '1.0.0', source: 'github:x/pixel', ref: 'main', commitSha: SHA_A, installedAt: '2026-10-01T00:00:00.000Z', agentId: 'pixel', state: 'managed' }
    const v2 = { kind: 'agent', version: '2.0.0', source: 'github:x/pixel', ref: 'main', commitSha: SHA_B, installedAt: '2026-10-15T00:00:00.000Z', agentId: 'pixel', state: 'managed' }
    const p1 = { kind: 'skill-pack', version: '1.0.0', source: 'github:x/editorial', ref: 'main', commitSha: SHA_A, installedAt: '2026-10-01T00:00:00.000Z' }
    const p2 = { kind: 'skill-pack', version: '2.0.0', source: 'github:x/editorial', ref: 'main', commitSha: SHA_B, installedAt: '2026-10-15T00:00:00.000Z' }
    const records = recordMap([record({ id: 'package:pixel', outcome: 'current' }), record({ id: 'package:editorial', outcome: 'current' })])
    for (const packages of [
      { 'pixel@1.0.0': v1, 'pixel@2.0.0': v2, 'editorial@1.0.0': p1, 'editorial@2.0.0': p2 },
      { 'pixel@2.0.0': v2, 'pixel@1.0.0': v1, 'editorial@2.0.0': p2, 'editorial@1.0.0': p1 },
    ]) {
      const src = sources({ packageLock: { version: 1, packages } as unknown as Lockfile })
      const [pixel, editorial] = joinInstallState([entry({ id: 'pixel', kind: 'agent' }), entry({ id: 'editorial', kind: 'skill-pack' })], src, records)
      expect(pixel).toMatchObject({ installed: true, installedVersion: '2.0.0', updateAvailable: false })
      expect(editorial).toMatchObject({ installed: true, installedVersion: '2.0.0', updateAvailable: false })
    }
  })

  it('review r2 #3 / r5 #6: a record observed for another installed identity is no answer — the row stays unknown (packages, plugins, and hub skills by their HUB identity)', () => {
    const src = sources({
      pluginLock: { version: 1, plugins: { messaging: pluginEntry({ version: '1.1.0' }) } } as InstallStateSources['pluginLock'],
      packageLock: {
        version: 1,
        packages: {
          'pixel@1.3.0': { kind: 'agent', version: '1.3.0', source: 'github:x/pixel', ref: 'main', commitSha: SHA_B, installedAt: 'now', agentId: 'pixel', state: 'managed' },
          'hub-weather@0.4.0': { kind: 'skill-pack', version: '0.4.0', source: 'clawhub:weather', ref: '', commitSha: '', installedAt: 'now' },
        },
      } as unknown as Lockfile,
    })
    // The hub skill's installed identity is the HUB's resolved version (0.5.0 after a re-install), never the frontmatter 0.4.0 (r5 #6).
    src.packages = src.packages.map((pkg) => (pkg.id === 'hub-weather' ? { ...pkg, upstream: { source: 'clawhub:weather', ref: '0.5.0' } } : pkg))
    const records = recordMap([
      // Observed for 1.0.0 — the lockfile now holds 1.1.0 (just upgraded): no answer, never "update available" for the version just installed.
      record({ id: 'plugin:messaging', outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', sha: SHA_B, display: '1.1.0' } }),
      record({ id: 'package:pixel', outcome: 'update-available', installed: { version: '1.2.0', sha: SHA_A, display: '1.2.0' }, available: { version: '1.3.0', sha: SHA_B, display: '1.3.0' } }),
      // Observed when the hub's resolved version was 0.4.0 and offering 0.5.0 — which is now installed: no answer.
      record({ id: 'hub-skill:hub-weather', outcome: 'update-available', installed: { version: '0.4.0', display: '0.4.0' }, available: { version: '0.5.0', display: '0.5.0' } }),
    ])
    const [messaging, pixel, weather] = joinInstallState(
      [entry({ id: 'messaging', kind: 'plugin' }), entry({ id: 'pixel', kind: 'agent' }), entry({ id: 'hub-weather', kind: 'skill-pack' })],
      src,
      records,
    )
    expect(messaging).toMatchObject({ installed: true, updateAvailable: null, installedVersion: '1.1.0' })
    expect(pixel).toMatchObject({ installed: true, updateAvailable: null, installedVersion: '1.3.0' })
    expect(weather).toMatchObject({ installed: true, updateAvailable: null })
    const stillOffered = recordMap([record({ id: 'hub-skill:hub-weather', outcome: 'update-available', installed: { version: '0.5.0', display: '0.5.0' }, available: { version: '0.6.0', display: '0.6.0' } })])
    expect(joinInstallState([entry({ id: 'hub-weather', kind: 'skill-pack' })], src, stillOffered)[0]).toMatchObject({ updateAvailable: true, updateOutcome: 'update-available' })

    // A LOCAL plugin rebuilt since the observation: same version, new tree digest — the stored offer is no answer (r4 #4).
    const rebuilt = sources({ pluginLock: { version: 1, plugins: { mine: pluginEntry({ type: 'local', source: '/src/mine', ref: '', commitSha: '', sourceTreeSha: 'f'.repeat(64), sourceTreeShaAlgo: 3 }) } } as InstallStateSources['pluginLock'] })
    const [mine] = joinInstallState([entry({ id: 'mine', kind: 'plugin' })], rebuilt, recordMap([
      record({ id: 'plugin:mine', outcome: 'update-available', installed: { version: '1.0.0', digest: 'e'.repeat(64), display: '1.0.0' }, available: { digest: 'f'.repeat(64), display: 'local changes' } }),
    ]))
    expect(mine).toMatchObject({ installed: true, updateAvailable: null })
    const [mineStill] = joinInstallState([entry({ id: 'mine', kind: 'plugin' })], rebuilt, recordMap([
      record({ id: 'plugin:mine', outcome: 'update-available', installed: { version: '1.0.0', digest: 'f'.repeat(64), display: '1.0.0' }, available: { digest: '0'.repeat(64), display: 'local changes' } }),
    ]))
    expect(mineStill).toMatchObject({ installed: true, updateAvailable: true })
  })

  it('updateStateOf: unknown and absent are null; blocked and unsupported are not updates but keep their outcome and reason; a skipped offer says so (r5 #7)', () => {
    expect(updateStateOf(undefined)).toEqual({ updateAvailable: null, updateOutcome: null })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'unknown' }))).toEqual({ updateAvailable: null, updateOutcome: null })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'blocked', blockedReason: 'no remote ref: release-1' }))).toEqual({ updateAvailable: false, updateOutcome: 'blocked', updateReason: 'no remote ref: release-1' })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'unsupported', blockedReason: 'a local directory has no upstream' }))).toEqual({ updateAvailable: false, updateOutcome: 'unsupported', updateReason: 'a local directory has no upstream' })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'current' }))).toEqual({ updateAvailable: false, updateOutcome: 'current' })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'update-available', available: { version: '2', display: '2' } }))).toEqual({ updateAvailable: true, updateOutcome: 'update-available' })
    expect(updateStateOf(record({ id: 'plugin:x', outcome: 'update-available', available: { version: '2', display: '2' }, skipped: { version: '2' } }))).toEqual({ updateAvailable: false, updateOutcome: 'skipped' })
    expect(updateAvailableOf(record({ id: 'plugin:x', outcome: 'blocked' }))).toBe(false)
  })

  it('a plugin directory without a lock entry still counts as installed', () => {
    // Pre-lockfile installs / seeded dev homes: dir exists, no ledger row.
    const src = sources({ installedPluginDirs: new Set(['messaging']) })
    const [messaging] = joinInstallState([entry({ id: 'messaging', kind: 'plugin' })], src)
    expect(messaging).toMatchObject({ installed: true, updateAvailable: null, installedVersion: null })
  })

  it('packs match lockfile keys of the form id or id@version', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'writing-skills@2.0.0': {
            kind: 'skill-pack', version: '2.0.0', source: 'github:x#packs/writing-skills',
            ref: 'main', commitSha: SHA_A, installedAt: 'now',
          },
        },
      } as Lockfile,
    })
    const [installed, absent] = joinInstallState(
      [entry({ id: 'writing-skills', kind: 'skill-pack' }), entry({ id: 'other', kind: 'lesson-pack' })],
      src,
    )
    expect(installed).toMatchObject({ installed: true, installedVersion: '2.0.0' })
    expect(absent).toMatchObject({ installed: false })
  })

  it('pack matching never crosses kinds', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'shared-name@1.0.0': {
            kind: 'workflow-pack', version: '1.0.0', source: 'github:x#packs/shared-name',
            ref: 'main', commitSha: SHA_A, installedAt: 'now',
          },
        },
      } as Lockfile,
    })
    const [lessonPack] = joinInstallState([entry({ id: 'shared-name', kind: 'lesson-pack' })], src)
    expect(lessonPack.installed).toBe(false)
  })
})
