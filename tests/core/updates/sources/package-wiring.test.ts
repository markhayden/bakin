/** The package/hub-skill source wiring: default-branch parsing and local-path resolution the installer's way (PR 8 review r1 #1/#5). */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-package-wiring-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
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

import { createPackageUpdateSources, installedPackages, localPackageManifest, pickDefaultBranch } from '../../../../src/core/updates/sources/package-wiring'
import { writeLockfile, type PackageEntry } from '../../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../../packages/core/src/agent-packages/package-paths'

const originalHome = process.env.HOME
afterEach(() => { process.env.HOME = originalHome })
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

describe('pickDefaultBranch', () => {
  it('reads the symbolic HEAD row; a detached or unborn HEAD has none', () => {
    const sha = 'a'.repeat(40)
    expect(pickDefaultBranch(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`)).toBe('main')
    expect(pickDefaultBranch(`ref: refs/heads/release/2026\tHEAD\n${sha}\tHEAD\n`)).toBe('release/2026')
    expect(pickDefaultBranch(`${sha}\tHEAD\n`)).toBeNull()
    expect(pickDefaultBranch('')).toBeNull()
  })
})

describe('localPackageManifest', () => {
  it('resolves a home-relative source the way the installer recorded it; a missing directory is null', () => {
    process.env.HOME = testDir
    mkdirSync(join(testDir, 'packs', 'notes'), { recursive: true })
    writeFileSync(join(testDir, 'packs', 'notes', 'bakin-package.json'), JSON.stringify({ id: 'notes', version: '1.2.0', kind: 'skill-pack', name: 'notes', description: 'x', contributions: { skills: ['notes'] } }))
    expect(localPackageManifest('~/packs/notes')).toEqual({ id: 'notes', version: '1.2.0' })
    expect(localPackageManifest(join(testDir, 'packs', 'notes'))).toEqual({ id: 'notes', version: '1.2.0' })
    expect(localPackageManifest('~/packs/gone')).toBeNull()
  })
})

describe('installedPackages — ownership never flips on an unreadable manifest (PR 8 review r6 #2)', () => {
  const row = (over: Partial<PackageEntry>): PackageEntry => ({ kind: 'skill-pack', version: '1.0.0', source: 'clawhub:weather', ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', ...over })
  const manifestAt = (id: string, content: string) => {
    const dir = getPackageSourceDir(testDir, 'skill-pack', id, '1.0.0')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bakin-package.json'), content)
  }

  it('the ledger flag, a readable manifest, or a clawhub source keep a hub skill a hub skill; an unreadable manifest is reported, not re-partitioned', () => {
    writeLockfile({ version: 1, packages: {
      'flagged@1.0.0': row({ source: 'github:acme/skills#flagged', hub: true }),
      'parsed@1.0.0': row({ source: 'github:acme/skills#parsed' }),
      'hubby@1.0.0': row({ source: 'clawhub:hubby' }),
      'plain@1.0.0': row({ source: 'github:acme/plain' }),
      'fine@1.0.0': row({ source: 'github:acme/fine' }),
    } })
    manifestAt('flagged', '{ not json')
    manifestAt('parsed', JSON.stringify({ id: 'parsed', version: '1.0.0', kind: 'skill-pack', name: 'parsed', description: 'x', contributions: { skills: ['x'] }, upstream: { source: 'github:acme/skills#parsed', ref: 'main', resolvedSha: 'a'.repeat(40) } }))
    manifestAt('hubby', '{ not json')
    manifestAt('plain', '{ not json')
    manifestAt('fine', JSON.stringify({ id: 'fine', version: '1.0.0', kind: 'skill-pack', name: 'fine', description: 'x', contributions: { skills: ['x'] } }))
    const byId = new Map(installedPackages().map((pkg) => [pkg.id, pkg]))
    expect(byId.get('flagged')).toMatchObject({ upstream: { source: 'github:acme/skills#flagged' }, manifestError: expect.any(String) })
    expect(byId.get('parsed')).toMatchObject({ upstream: { source: 'github:acme/skills#parsed', ref: 'main' } })
    expect(byId.get('parsed')?.manifestError).toBeUndefined()
    expect(byId.get('hubby')).toMatchObject({ upstream: { source: 'clawhub:hubby' }, manifestError: expect.any(String) })
    expect(byId.get('plain')).toMatchObject({ upstream: null, manifestError: expect.any(String) })
    expect(byId.get('fine')).toMatchObject({ upstream: null })
    expect(byId.get('fine')?.manifestError).toBeUndefined()
    // The sources partition on that ownership: the two unreadable hub skills stay `hub-skill` subjects, `plain` a package.
    const [pkgSource, hubSource] = createPackageUpdateSources()
    expect(hubSource!.kind).toBe('hub-skill')
    expect(pkgSource!.kind).toBe('package')
  })
})
