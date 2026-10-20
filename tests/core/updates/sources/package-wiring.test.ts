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

import { localPackageManifest, pickDefaultBranch } from '../../../../src/core/updates/sources/package-wiring'

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
