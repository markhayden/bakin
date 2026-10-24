/**
 * Asset recovery engine (self-healing PR1 slice 1.4a; re-homing rows 180–182):
 * what a broken asset directory looks like, and the three human controls the
 * recover page offers — rebuild the manifest from the files on disk, detach
 * versions whose files are gone, restore a version from an export.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-asset-recovery-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: pathJoin(testDir, 'bakin.db'), media: pathJoin(testDir, 'media') }), isUsingBakinHome: () => true })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { detachMissingVersions, inspectAssetRecovery, rebuildManifestFromFiles, restoreVersionFromExport } from '../../../plugins/assets/lib/asset-recovery'
import { assetDirAbs } from '../../../plugins/assets/lib/asset-id'
import { readManifest } from '../../../plugins/assets/lib/manifest'

const ID = '20260704-recover-a1b2c3d4'
const dir = () => assetDirAbs(ID)!
const version = (n: number, file: string) => ({ version: n, file, thumb: null, mimeType: 'text/plain', size: 5, width: null, height: null, created: '2026-07-04T00:00:00.000Z', description: `v${n}`, op: 'upload', parentVersion: n > 1 ? n - 1 : null, tool: null, prompt: null, promptHash: null, generation: null })
const manifest = (over: Record<string, unknown> = {}) => ({ assetId: ID, type: 'text', source: { kind: 'upload', path: null }, agent: 'pixel', taskId: 'task-1', created: '2026-07-04T00:00:00.000Z', updated: '2026-07-04T00:00:00.000Z', currentVersion: 2, description: 'v2', tags: ['notes'], versions: [version(1, 'v1.txt'), version(2, 'v2.txt')], exports: [], ...over })

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(dir(), { recursive: true }) })

describe('inspectAssetRecovery', () => {
  it('names a missing manifest and the version files on disk; an unknown id is not a directory', () => {
    writeFileSync(pathJoin(dir(), 'v1.txt'), 'one')
    writeFileSync(pathJoin(dir(), 'v2.txt'), 'two')
    writeFileSync(pathJoin(dir(), 'v2.thumb.jpg'), 'x')
    const report = inspectAssetRecovery(ID)
    expect(report).toMatchObject({ assetId: ID, dirExists: true, manifest: { status: 'missing' } })
    expect(report.filesOnDisk.map((f) => f.name)).toEqual(['v1.txt', 'v2.thumb.jpg', 'v2.txt'])
    expect(report.versionFiles.map((f) => f.version)).toEqual([1, 2])
    expect(inspectAssetRecovery('20260704-nothing-ffffffff').dirExists).toBe(false)
  })
  it('names an invalid manifest with its reason, and the versions whose files are gone', () => {
    writeFileSync(pathJoin(dir(), 'manifest.json'), '{ nope')
    expect(inspectAssetRecovery(ID).manifest).toMatchObject({ status: 'invalid' })
    writeFileSync(pathJoin(dir(), 'manifest.json'), JSON.stringify(manifest()))
    writeFileSync(pathJoin(dir(), 'v1.txt'), 'one')
    const report = inspectAssetRecovery(ID)
    expect(report.manifest).toMatchObject({ status: 'ok', currentVersion: 2, currentVersionPresent: false })
    expect(report.versions).toEqual([{ version: 1, file: 'v1.txt', present: true }, { version: 2, file: 'v2.txt', present: false }])
  })
})

describe('rebuildManifestFromFiles', () => {
  it('writes a manifest from the version files on disk (type from the files, newest current, nothing invented) — only when the manifest is missing or invalid', async () => {
    writeFileSync(pathJoin(dir(), 'v1.txt'), 'one')
    writeFileSync(pathJoin(dir(), 'v3.txt'), 'three')
    const rebuilt = await rebuildManifestFromFiles(ID)
    expect(rebuilt.versions.map((v) => [v.version, v.file, v.op])).toEqual([[1, 'v1.txt', 'import'], [3, 'v3.txt', 'import']])
    expect(rebuilt).toMatchObject({ assetId: ID, type: 'text', currentVersion: 3, taskId: null, agent: 'system', tags: [], exports: [] })
    expect(readManifest(dir())?.currentVersion).toBe(3)
    await expect(rebuildManifestFromFiles(ID)).rejects.toThrow(/already valid/)
  })
  it('refuses when no version file exists (nothing to rebuild from — trash is the remaining option)', async () => {
    writeFileSync(pathJoin(dir(), 'notes.md'), 'x')
    await expect(rebuildManifestFromFiles(ID)).rejects.toThrow(/no version files/)
  })
})

describe('detachMissingVersions', () => {
  it('drops the versions whose files are gone, repoints current at the newest remaining, and prunes exports whose files are gone', async () => {
    mkdirSync(pathJoin(dir(), 'exports'), { recursive: true })
    writeFileSync(pathJoin(dir(), 'manifest.json'), JSON.stringify(manifest({ exports: [{ name: 'web', surface: 'web', format: 'png', file: 'exports/web.png', width: 1, height: 1, fromVersion: 2, created: 'x' }, { name: 'kept', surface: 'web', format: 'png', file: 'exports/kept.png', width: 1, height: 1, fromVersion: 1, created: 'x' }] })))
    writeFileSync(pathJoin(dir(), 'v1.txt'), 'one')
    writeFileSync(pathJoin(dir(), 'exports', 'kept.png'), 'k')
    const result = await detachMissingVersions(ID)
    expect(result.detachedVersions).toEqual([2])
    expect(result.detachedExports).toEqual(['web'])
    const after = readManifest(dir())!
    expect(after.versions.map((v) => v.version)).toEqual([1])
    expect(after.currentVersion).toBe(1)
    expect(after.description).toBe('v1')
    expect(after.exports.map((e) => e.name)).toEqual(['kept'])
  })
  it('refuses when every version file is gone — the asset has nothing left to stand on', async () => {
    writeFileSync(pathJoin(dir(), 'manifest.json'), JSON.stringify(manifest()))
    await expect(detachMissingVersions(ID)).rejects.toThrow(/[Nn]o version file remains/)
    expect(readManifest(dir())?.versions).toHaveLength(2)
  })
})

describe('restoreVersionFromExport', () => {
  it('adds the export file back as a new current version, with its provenance in the description', async () => {
    mkdirSync(pathJoin(dir(), 'exports'), { recursive: true })
    writeFileSync(pathJoin(dir(), 'manifest.json'), JSON.stringify(manifest({ exports: [{ name: 'plain', surface: 'print', format: 'txt', file: 'exports/plain.txt', width: null, height: null, fromVersion: 2, created: 'x' }] })))
    writeFileSync(pathJoin(dir(), 'v1.txt'), 'one')
    writeFileSync(pathJoin(dir(), 'exports', 'plain.txt'), 'two again')
    const result = await restoreVersionFromExport(ID, 'plain')
    expect(result.version).toBe(3)
    const after = readManifest(dir())!
    expect(after.currentVersion).toBe(3)
    expect(after.versions.find((v) => v.version === 3)).toMatchObject({ file: 'v3.txt', op: 'import', description: expect.stringContaining('plain') })
    expect(existsSync(pathJoin(dir(), 'v3.txt'))).toBe(true)
    expect(readFileSync(pathJoin(dir(), 'v3.txt'), 'utf-8')).toBe('two again')
    await expect(restoreVersionFromExport(ID, 'nope')).rejects.toThrow(/no export named/)
  })
})
