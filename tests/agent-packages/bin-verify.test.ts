/**
 * verifyInstalledBin — the ONE predicate behind the installer's skip check
 * and the plugin-assets readiness scan (spec plugin-managed-binaries §2.7).
 * Raw downloads: file hash == pin. Archives: marker pin == manifest pin AND
 * file hash == marker.extractedSha256. Changed bytes are never "installed".
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
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
  const download = { url: 'https://example.com/tool.tar.gz', sha256: sha('archive bytes'), archive: { format: 'tar.gz' as const, member: 'tool' } }
  it('installed when the marker pins the archive and the file hash equals the recorded extracted hash', () => {
    writeFileSync(BIN, 'extracted'); writeInstalledBy(BIN, marker({ sha256: download.sha256, extractedSha256: sha('extracted'), member: 'tool' }))
    expect(verifyInstalledBin(BIN, download).status).toBe('installed')
  })
  it('drifted when the bytes change under an untouched marker', () => {
    writeFileSync(BIN, 'extracted'); writeInstalledBy(BIN, marker({ sha256: download.sha256, extractedSha256: sha('extracted'), member: 'tool' }))
    writeFileSync(BIN, 'swapped')
    expect(verifyInstalledBin(BIN, download).status).toBe('drifted')
  })
  it('drifted when the marker records a different member of the same archive — another owner\'s binary under our name', () => {
    writeFileSync(BIN, 'extracted'); writeInstalledBy(BIN, marker({ sha256: download.sha256, extractedSha256: sha('extracted'), member: 'other-tool' }))
    expect(verifyInstalledBin(BIN, download)).toMatchObject({ status: 'drifted', reason: 'member-mismatch' })
  })
  it('drifted when the marker pins a different archive (a newer pin) or is missing', () => {
    writeFileSync(BIN, 'extracted'); writeInstalledBy(BIN, marker({ sha256: sha('other archive'), extractedSha256: sha('extracted'), member: 'tool' }))
    expect(verifyInstalledBin(BIN, download).status).toBe('drifted')
    rmSync(join(testDir, 'bin', 'tool.installedBy'), { force: true })
    expect(verifyInstalledBin(BIN, download).status).toBe('drifted')
  })
})
