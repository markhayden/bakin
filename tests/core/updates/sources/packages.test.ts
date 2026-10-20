/** The `package` and `hub-skill` update sources (#1007 D7.12): tracking policy from the lock source, identity from upstream.ref, never the frontmatter version. */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-packages-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import type { PackageEntry } from '@bakin/core/agent-packages/lockfile'
import { createUpdatesEngine } from '../../../../src/core/updates/engine'
import { createHubSkillSource, type HubSkillSourceDeps } from '../../../../src/core/updates/sources/hub-skill'
import { createPackageSource, packageIdOfKey, packageSourceWithRef, type InstalledPackage, type PackageSourceDeps } from '../../../../src/core/updates/sources/package'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function entry(over: Partial<PackageEntry> = {}): PackageEntry {
  return { kind: 'skill-pack', version: '1.0.0', source: 'clawhub:weather', ref: '', commitSha: '', installedAt: '2026-10-20T10:00:00.000Z', ...over }
}
function installed(id: string, over: Partial<PackageEntry> = {}, upstream: InstalledPackage['upstream'] = null): InstalledPackage {
  const e = entry(over)
  return { key: `${id}@${e.version}`, id, entry: e, upstream }
}
const engine = (sources: Parameters<typeof createUpdatesEngine>[0]['sources']) =>
  createUpdatesEngine({ storePath: join(testDir, `${randomUUID()}.json`), sources, intervalMs: 3_600_000 })

function packageDeps(over: Partial<PackageSourceDeps> = {}): PackageSourceDeps {
  return {
    installed: () => [],
    hostVersion: () => '0.1.0',
    cloneUrl: (source) => `https://github.com/${source.slice('github:'.length).replace(/[@#].*$/, '')}.git`,
    lsRemote: async () => null,
    defaultBranch: async () => null,
    fetchManifest: async () => { throw new Error('no clone expected') },
    localManifest: () => null,
    ...over,
  }
}
function hubDeps(over: Partial<HubSkillSourceDeps> = {}, hub: Partial<HubSkillSourceDeps['hub']> = {}): HubSkillSourceDeps {
  return {
    installed: () => [],
    hostVersion: () => '0.1.0',
    cloneUrl: (source) => `https://github.com/${source.slice('github:'.length).replace(/[@#].*$/, '')}.git`,
    lsRemote: async () => null,
    defaultBranch: async () => null,
    hub: { latest: async () => null, hasVersion: async () => false, ...hub },
    ...over,
  }
}

describe('helpers', () => {
  it('the lockfile key\'s id is everything before the LAST @; a github ref folds in only when the source carries none', () => {
    expect(packageIdOfKey('weather@1.2.0')).toBe('weather')
    expect(packageIdOfKey('acme.weather@1.2.0')).toBe('acme.weather')
    expect(packageIdOfKey('weather')).toBe('weather')
    expect(packageSourceWithRef('github:acme/skills#packs/weather', 'main')).toBe('github:acme/skills@main#packs/weather')
    expect(packageSourceWithRef('github:acme/skills@v2#packs/weather', 'main')).toBe('github:acme/skills@v2#packs/weather')
    expect(packageSourceWithRef('/local/dir', 'main')).toBe('/local/dir')
  })
})

describe('hub-skill source — ClawHub tracking policy', () => {
  it('partitions by provenance: a skill-pack with upstream is a hub skill, every other entry a package — never both', async () => {
    const rows = [
      installed('weather', { source: 'clawhub:weather' }, { source: 'clawhub:weather', ref: '1.2.0' }),
      installed('notes', { kind: 'skill-pack', source: '/local/notes' }),
      installed('ops', { kind: 'agent', source: 'github:acme/ops', ref: 'main', commitSha: SHA_A }),
    ]
    const hub = createHubSkillSource(hubDeps({ installed: () => rows }))
    const pkg = createPackageSource(packageDeps({ installed: () => rows }))
    expect((await hub.inventory()).map((row) => row.subject.id)).toEqual(['weather'])
    expect((await pkg.inventory()).map((row) => row.subject.id).sort()).toEqual(['notes', 'ops'])
  })

  it('UNPINNED (`clawhub:<slug>`) tracks latest: a newer hub version is an update, the same resolved version is current — the frontmatter version is never compared', async () => {
    const weather = installed('weather', { source: 'clawhub:weather', version: '9.9.9' /* frontmatter says 9.9.9 */ }, { source: 'clawhub:weather', ref: '1.2.0' })
    const asked: string[] = []
    const newer = createHubSkillSource(hubDeps({ installed: () => [weather] }, { latest: async (slug) => { asked.push(slug); return '1.3.0' } }))
    const record = await engine([newer]).observe('hub-skill:weather')
    expect(record).toMatchObject({ outcome: 'update-available', reason: 'newer-version', installed: { version: '1.2.0' }, available: { version: '1.3.0' }, action: { kind: 'manual', pointer: 'bakin skills install clawhub:weather' } })
    expect(asked).toEqual(['weather'])
    const same = createHubSkillSource(hubDeps({ installed: () => [weather] }, { latest: async () => '1.2.0' }))
    expect((await engine([same]).observe('hub-skill:weather')).outcome).toBe('current')
  })

  it('PINNED (`clawhub:<slug>@<v>`) is current while the hub still publishes that version, blocked once it is gone — latest is never asked', async () => {
    const pinned = installed('weather', { source: 'clawhub:weather@1.2.0' }, { source: 'clawhub:weather@1.2.0', ref: '1.2.0' })
    let latestAsked = 0
    const still = createHubSkillSource(hubDeps({ installed: () => [pinned] }, { latest: async () => { latestAsked += 1; return '2.0.0' }, hasVersion: async (slug, version) => slug === 'weather' && version === '1.2.0' }))
    expect((await engine([still]).observe('hub-skill:weather')).outcome).toBe('current')
    const gone = createHubSkillSource(hubDeps({ installed: () => [pinned] }, { latest: async () => { latestAsked += 1; return '2.0.0' }, hasVersion: async () => false }))
    const record = await engine([gone]).observe('hub-skill:weather')
    expect(record).toMatchObject({ outcome: 'blocked', blockedReason: expect.stringContaining('1.2.0 is no longer published') })
    expect(latestAsked).toBe(0)
  })

  it('an owner-qualified pin (`clawhub:@owner/slug@v`) asks the hub with the owner', async () => {
    const pinned = installed('weather', { source: 'clawhub:@acme/weather@1.2.0' }, { source: 'clawhub:@acme/weather@1.2.0', ref: '1.2.0' })
    const seen: Array<[string, string, string | undefined]> = []
    const source = createHubSkillSource(hubDeps({ installed: () => [pinned] }, { hasVersion: async (slug, version, owner) => { seen.push([slug, version, owner]); return true } }))
    expect((await engine([source]).observe('hub-skill:weather')).outcome).toBe('current')
    expect(seen).toEqual([['weather', '1.2.0', 'acme']])
  })

  it('two successive updates to an initially UNPINNED skill: after the first re-install the lock source is still `clawhub:<slug>`, so the second update is offered too', async () => {
    const rows = [installed('weather', { source: 'clawhub:weather' }, { source: 'clawhub:weather', ref: '1.2.0' })]
    let latest = '1.3.0'
    const source = createHubSkillSource(hubDeps({ installed: () => rows }, { latest: async () => latest }))
    const e = engine([source])
    expect((await e.observe('hub-skill:weather')).available?.version).toBe('1.3.0')
    // The re-install downloaded clawhub:weather@1.3.0 but recorded the TRACKING source (R8′) — a new fingerprint, the record retires.
    rows[0] = installed('weather', { source: 'clawhub:weather', installedAt: '2026-10-20T11:00:00.000Z' }, { source: 'clawhub:weather', ref: '1.3.0' })
    await e.refreshInventory()
    expect((await e.observe('hub-skill:weather')).outcome).toBe('current')
    latest = '1.4.0'
    expect((await e.observe('hub-skill:weather')).available?.version).toBe('1.4.0')
    // Had the re-install persisted the fetch ref as the source, the skill would read as pinned and the second update would never be offered.
    rows[0] = installed('weather', { source: 'clawhub:weather@1.3.0', installedAt: '2026-10-20T12:00:00.000Z' }, { source: 'clawhub:weather@1.3.0', ref: '1.3.0' })
    await e.refreshInventory()
    const asPinned = createHubSkillSource(hubDeps({ installed: () => rows }, { latest: async () => '1.4.0', hasVersion: async () => true }))
    expect((await engine([asPinned]).observe('hub-skill:weather')).outcome).toBe('current')
  })

  it('a github-sourced hub skill compares the ref\'s ls-remote sha with the installed commit; a local directory is unsupported', async () => {
    const gh = installed('weather', { source: 'github:acme/skills#packs/weather', ref: 'main', commitSha: SHA_A }, { source: 'github:acme/skills#packs/weather', ref: 'main' })
    const moved = createHubSkillSource(hubDeps({ installed: () => [gh], lsRemote: async (url, ref) => (url === 'https://github.com/acme/skills.git' && ref === 'main' ? SHA_B : null) }))
    expect(await engine([moved]).observe('hub-skill:weather')).toMatchObject({ outcome: 'update-available', reason: 'newer-commit', available: { sha: SHA_B }, action: { kind: 'manual', pointer: 'bakin skills install github:acme/skills@main#packs/weather' } })
    const same = createHubSkillSource(hubDeps({ installed: () => [gh], lsRemote: async () => SHA_A }))
    expect((await engine([same]).observe('hub-skill:weather')).outcome).toBe('current')
    const local = installed('notes', { source: '/Users/me/skills/notes' }, { source: '/Users/me/skills/notes' })
    const dir = createHubSkillSource(hubDeps({ installed: () => [local] }))
    expect((await engine([dir]).observe('hub-skill:notes')).outcome).toBe('unsupported')
  })
})

describe('package source', () => {
  it('a github package: ls-remote against the installed commit; the manifest is cloned ONLY when the ref moved, naming the version on offer', async () => {
    const ops = installed('ops', { kind: 'agent', agentId: 'ops', source: 'github:acme/ops', ref: 'main', commitSha: SHA_A })
    let clones = 0
    const same = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_A, fetchManifest: async () => { clones += 1; return { id: 'ops', version: '2.0.0', commitSha: SHA_B } } }))
    expect((await engine([same]).observe('package:ops')).outcome).toBe('current')
    expect(clones).toBe(0)
    const moved = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_B, fetchManifest: async (sourceWithRef) => { clones += 1; expect(sourceWithRef).toBe('github:acme/ops@main'); return { id: 'ops', version: '2.0.0', commitSha: SHA_B } } }))
    const record = await engine([moved]).observe('package:ops')
    expect(record).toMatchObject({ outcome: 'update-available', reason: 'newer-version', installed: { version: '1.0.0', sha: SHA_A }, available: { version: '2.0.0', sha: SHA_B }, action: { kind: 'manual', pointer: 'bakin agents sync ops' } })
    expect(clones).toBe(1)
    // Same version, newer commit: still an update (the commit is the identity), named by the commit.
    const sameVersion = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_B, fetchManifest: async () => ({ id: 'ops', version: '1.0.0', commitSha: SHA_B }) }))
    expect(await engine([sameVersion]).observe('package:ops')).toMatchObject({ outcome: 'update-available', reason: 'newer-commit', available: { version: '1.0.0', sha: SHA_B, display: `1.0.0 (${SHA_B.slice(0, 7)})` } })
  })

  it('review r1 #1: an entry installed without @ref (empty lock ref) tracks the remote DEFAULT branch — resolved, compared, fetched there; a remote without one is blocked', async () => {
    const ops = installed('ops', { kind: 'workflow-pack', source: 'github:acme/ops', ref: '', commitSha: SHA_A })
    const asked: string[] = []
    const moved = createPackageSource(packageDeps({
      installed: () => [ops],
      defaultBranch: async (url) => { asked.push(url); return 'trunk' },
      lsRemote: async (url, ref) => (url === 'https://github.com/acme/ops.git' && ref === 'trunk' ? SHA_B : null),
      fetchManifest: async (sourceWithRef) => { expect(sourceWithRef).toBe('github:acme/ops@trunk'); return { id: 'ops', version: '2.0.0', commitSha: SHA_B } },
    }))
    const [entryFor] = await moved.inventory()
    const observed = await moved.observe(entryFor!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })
    expect(asked).toEqual(['https://github.com/acme/ops.git'])
    expect(observed).toMatchObject({ outcome: 'update-available', available: { version: '2.0.0', sha: SHA_B }, source: { kind: 'git-ref', ref: 'trunk' } })

    const same = createPackageSource(packageDeps({ installed: () => [ops], defaultBranch: async () => 'trunk', lsRemote: async () => SHA_A }))
    expect((await same.observe(entryFor!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })).outcome).toBe('current')

    const headless = createPackageSource(packageDeps({ installed: () => [ops], defaultBranch: async () => null, lsRemote: async () => { throw new Error('never asked') } }))
    expect(await headless.observe(entryFor!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })).toMatchObject({ outcome: 'blocked', blockedReason: expect.stringContaining('no default branch') })

    // The hub-skill github lane resolves the same way, and its re-install pointer stays UNPINNED (the source as installed).
    const gh = installed('hub-tools', { source: 'github:acme/skills#tools', ref: '', commitSha: SHA_A }, { source: 'github:acme/skills#tools' })
    const hub = createHubSkillSource(hubDeps({ installed: () => [gh], defaultBranch: async () => 'main', lsRemote: async (url, ref) => (ref === 'main' ? SHA_B : null) }))
    const [hubEntry] = await hub.inventory()
    expect(await hub.observe(hubEntry!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })).toMatchObject({ outcome: 'update-available', action: { kind: 'manual', pointer: 'bakin skills install github:acme/skills#tools' } })
  })

  it('review r1 #4: a cached checkout older than the observed commit is refetched FRESH and the fresh checkout is the offer; a fresh checkout at the installed commit is current', async () => {
    const ops = installed('ops', { kind: 'workflow-pack', source: 'github:acme/ops', ref: 'main', commitSha: SHA_A })
    const fetches: Array<{ fresh: boolean }> = []
    const staleCache = createPackageSource(packageDeps({
      installed: () => [ops],
      lsRemote: async () => SHA_B,
      fetchManifest: async (_spec, _signal, opts) => {
        fetches.push({ fresh: opts?.fresh === true })
        // The 5-minute checkout cache still holds the INSTALLED commit; only a fresh clone sees B.
        return opts?.fresh ? { id: 'ops', version: '2.0.0', commitSha: SHA_B } : { id: 'ops', version: '1.0.0', commitSha: SHA_A }
      },
    }))
    const [entryFor] = await staleCache.inventory()
    const ctx = { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } }
    expect(await staleCache.observe(entryFor!, ctx)).toMatchObject({ outcome: 'update-available', available: { version: '2.0.0', sha: SHA_B } })
    expect(fetches).toEqual([{ fresh: false }, { fresh: true }])

    // The ref moved back between ls-remote and the fresh clone: what is there now IS the installed commit — never an offer of the installed identity.
    const movedBack = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_B, fetchManifest: async () => ({ id: 'ops', version: '1.0.0', commitSha: SHA_A }) }))
    expect((await movedBack.observe(entryFor!, ctx)).outcome).toBe('current')

    // A cached checkout already AT the observed commit is used as is — one fetch.
    const warm: Array<{ fresh: boolean }> = []
    const cachedAtB = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_B, fetchManifest: async (_s, _g, opts) => { warm.push({ fresh: opts?.fresh === true }); return { id: 'ops', version: '2.0.0', commitSha: SHA_B } } }))
    expect((await cachedAtB.observe(entryFor!, ctx)).outcome).toBe('update-available')
    expect(warm).toEqual([{ fresh: false }])
  })

  it('a gone ref or a manifest whose id does not match is never an offer', async () => {
    const ops = installed('ops', { kind: 'workflow-pack', source: 'github:acme/ops', ref: 'main', commitSha: SHA_A })
    const gone = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => null }))
    expect(await engine([gone]).observe('package:ops')).toMatchObject({ outcome: 'blocked', blockedReason: 'no remote ref: main' })
    const impostor = createPackageSource(packageDeps({ installed: () => [ops], lsRemote: async () => SHA_B, fetchManifest: async () => ({ id: 'other', version: '2.0.0', commitSha: SHA_B }) }))
    const record = await engine([impostor]).observe('package:ops')
    expect(record.outcome).toBe('unknown')
    expect(record.attempt?.error).toMatch(/does not match installed package "ops"/)
  })

  it('a local package compares its directory manifest version; a missing directory is blocked', async () => {
    const notes = installed('notes', { kind: 'skill-pack', source: '/Users/me/packs/notes', version: '1.0.0' })
    const newer = createPackageSource(packageDeps({ installed: () => [notes], localManifest: () => ({ id: 'notes', version: '1.1.0' }) }))
    expect(await engine([newer]).observe('package:notes')).toMatchObject({ outcome: 'update-available', reason: 'newer-version', available: { version: '1.1.0' }, action: { kind: 'manual', pointer: 'bakin packages sync notes' } })
    const same = createPackageSource(packageDeps({ installed: () => [notes], localManifest: () => ({ id: 'notes', version: '1.0.0' }) }))
    expect((await engine([same]).observe('package:notes')).outcome).toBe('current')
    const missing = createPackageSource(packageDeps({ installed: () => [notes] }))
    expect((await engine([missing]).observe('package:notes')).outcome).toBe('blocked')
  })

  it('a package removed between inventory and observation is a failed attempt, not a crash; the fingerprint retires a record when the lock entry changes', async () => {
    const rows = [installed('ops', { kind: 'agent', source: 'github:acme/ops', ref: 'main', commitSha: SHA_A })]
    const source = createPackageSource(packageDeps({ installed: () => rows, lsRemote: async () => SHA_A }))
    const e = engine([source])
    expect((await e.observe('package:ops')).outcome).toBe('current')
    rows[0] = installed('ops', { kind: 'agent', source: 'github:acme/ops', ref: 'main', commitSha: SHA_B, installedAt: '2026-10-21T10:00:00.000Z' })
    await e.refreshInventory()
    const snapshot = await e.snapshot()
    expect(snapshot.records.find((r) => r.id === 'package:ops')?.outcome).toBe('unknown')
  })
})
