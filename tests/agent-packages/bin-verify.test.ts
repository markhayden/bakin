/**
 * verifyInstalledBin — the ONE predicate behind the installer's skip check
 * and the plugin-assets readiness scan (spec plugin-managed-binaries §2.7).
 * Raw downloads: file hash == pin. Archives: file hash == the manifest's
 * archive.extractedSha256. The .installedBy marker is never trusted — a
 * forged binary under a forged marker is drifted (#898 D).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-bin-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import { verifyInstalledBin } from '../../src/core/agent-packages/bin-verify'
import { writeInstalledBy } from '../../packages/core/src/agent-packages/markers'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const BIN = join(testDir, 'bin', 'tool')
const marker = (over: Record<string, unknown> = {}) => ({
  package: 'plugin:demo', version: '1.0.0', ref: '', commitSha: '', installedAt: new Date().toISOString(), ...over,
} as Parameters<typeof writeInstalledBy>[1])

beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(join(testDir, 'bin'), { recursive: true }) })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('verifyInstalledBin — raw download', () => {
  const download = { url: 'https://example.com/tool', sha256: sha('good bytes') }
  it('installed when the file hash equals the pin', () => {
    writeFileSync(BIN, 'good bytes')
    expect(verifyInstalledBin(BIN, download).status).toBe('installed')
  })
  it('drifted when only the executable bytes change (marker untouched)', () => {
    writeFileSync(BIN, 'good bytes'); writeInstalledBy(BIN, marker({ sha256: download.sha256 }))
    writeFileSync(BIN, 'tampered')
    expect(verifyInstalledBin(BIN, download).status).toBe('drifted')
  })
  it('missing when the file is absent', () => {
    expect(verifyInstalledBin(BIN, download).status).toBe('missing')
  })
})

describe('verifyInstalledBin — archive download', () => {
  const download = {
    url: 'https://example.com/tool.tar.gz', sha256: sha('archive bytes'),
    archive: { format: 'tar.gz' as const, member: 'tool', extractedSha256: sha('extracted') },
  }
  it('installed when the file hash equals the manifest\'s extracted pin — with or without a marker', () => {
    writeFileSync(BIN, 'extracted')
    expect(verifyInstalledBin(BIN, download).status).toBe('installed')
    writeInstalledBy(BIN, marker({ sha256: download.sha256, member: 'tool' }))
    expect(verifyInstalledBin(BIN, download).status).toBe('installed')
  })
  it('a forged binary under a forged marker is drifted — the marker is never the pin', () => {
    writeFileSync(BIN, 'forged')
    // A marker claiming everything matches, written raw by whoever planted the binary.
    writeFileSync(`${BIN}.installedBy`, JSON.stringify({ ...marker({ sha256: download.sha256, member: 'tool' }), extractedSha256: sha('forged') }))
    expect(JSON.parse(readFileSync(`${BIN}.installedBy`, 'utf-8')).extractedSha256).toBe(sha('forged'))
    expect(verifyInstalledBin(BIN, download)).toMatchObject({ status: 'drifted', reason: 'hash-mismatch' })
  })
  it('drifted when the bytes change, and missing when absent', () => {
    writeFileSync(BIN, 'swapped')
    expect(verifyInstalledBin(BIN, download).status).toBe('drifted')
    rmSync(BIN, { force: true })
    expect(verifyInstalledBin(BIN, download).status).toBe('missing')
  })
})

describe('verifyInstalledBin — never throws', () => {
  it('a directory where the binary should be is drifted (not-a-file), not an exception', () => {
    mkdirSync(BIN, { recursive: true })
    expect(verifyInstalledBin(BIN, { sha256: sha('x') })).toEqual({ status: 'drifted', reason: 'not-a-file' })
  })
})
