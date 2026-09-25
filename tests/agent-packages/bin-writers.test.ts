/**
 * The shared-bin contract at the writers (spec plugin-managed-binaries §2.4):
 * installManifestBins (every pack writer) and installPluginBins (plugins)
 * both run only under the install lock and refuse a pin another owner
 * holds differently — before any download. Identical pins share.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-bin-writers-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import { installManifestBins, installPluginBins } from '../../src/core/agent-packages/bin-installer'
import { releaseInstallLock, withInstallLock } from '../../src/core/install-core/install-lock'
import { BinPinConflictError } from '../../src/core/plugins/bin-owners'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { readInstalledBy } from '../../packages/core/src/agent-packages/markers'
import type { BinRequirement } from '../../packages/core/src/plugins/bin-requirement'
import type { Manifest } from '../../packages/core/src/agent-packages/manifest'

const SCRIPT = '#!/bin/sh\necho fixture\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const bunServe = (Bun as unknown as { serve: (o: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (f?: boolean) => void } }).serve
let server: { port: number; stop: (f?: boolean) => void }
let hits = 0
let NativeResponse: typeof Response
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}` as const

beforeAll(async () => {
  NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = bunServe({ port: 0, fetch: () => { hits++; return new NativeResponse(SCRIPT) } })
})
afterAll(() => { server.stop(true); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(join(testDir, 'bin'), { recursive: true }); hits = 0 })
afterEach(() => { try { releaseInstallLock() } catch { /* not held */ } })

const bin = (sha = sha256(SCRIPT)): BinRequirement => ({
  name: 'fixturebin', version: '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/fixturebin`, sha256: sha } },
})
const packManifest = (bins: BinRequirement[]): Manifest => ({
  id: 'ocr', kind: 'skill-pack', name: 'ocr', version: '1.0.0', capability: 'ocr', contributions: { skills: ['skills/ocr'] }, requires: { bins },
} as unknown as Manifest)
const packMarker = { package: 'ocr', version: '1.0.0', ref: '', commitSha: '', installedAt: new Date().toISOString() }
const target = () => join(testDir, 'bin', 'fixturebin')

function pluginPins(id: string, sha: string): void {
  writePluginLockfile(addPlugin(readPluginLockfile(), id, {
    source: `github:x/${id}`, type: 'github', ref: '', commitSha: '', installedAt: new Date().toISOString(),
    version: '1.0.0', permissions: [], manifestSha: 'm', installedBins: [{ name: 'fixturebin', sha256: sha }],
  }))
}
function packPins(key: string, sha: string): void {
  const lock = readLockfile()
  lock.packages[key] = { kind: 'skill-pack', version: '1.0.0', source: 'github:x/ocr', ref: '', commitSha: '', installedAt: new Date().toISOString(), projections: [{ kind: 'bin', target: target(), sha256: sha }] }
  writeLockfile(lock)
}

describe('installManifestBins (every pack writer)', () => {
  it('refuses to run outside the install lock', async () => {
    await expect(installManifestBins(packManifest([bin()]), packMarker, { projections: [] })).rejects.toThrow(/installManifestBins requires the install lock/)
    expect(hits).toBe(0)
  })

  it('refuses a pin a plugin holds differently — before any download', async () => {
    pluginPins('terminal', 'b'.repeat(64))
    await expect(withInstallLock(() => installManifestBins(packManifest([bin()]), packMarker, { projections: [] }))).rejects.toThrow(BinPinConflictError)
    expect(hits).toBe(0)
    expect(existsSync(target())).toBe(false)
  })

  it('shares an identical pin with a plugin, and a pack never conflicts with its own older lock key', async () => {
    pluginPins('terminal', sha256(SCRIPT))
    packPins('ocr@0.9.0', 'c'.repeat(64)) // the same pack's previous version — must not block its own upgrade
    const result = { projections: [] as Array<{ kind: string; target: string; sha256?: string }> }
    await withInstallLock(() => installManifestBins(packManifest([bin()]), packMarker, result as never))
    expect(existsSync(target())).toBe(true)
    expect(result.projections.map((p) => p.kind)).toEqual(['bin'])
  })
})

describe('installPluginBins', () => {
  const identity = { pluginId: 'terminal', version: '0.2.0', ref: 'main', commitSha: 'f'.repeat(40) }

  it('refuses to run outside the install lock', async () => {
    await expect(installPluginBins([bin()], identity)).rejects.toThrow(/installPluginBins requires the install lock/)
  })

  it('installs with a plugin:<id> marker, reports created, and skips (created:false) on re-run', async () => {
    await withInstallLock(async () => {
    const first = await installPluginBins([bin()], identity)
    expect(first).toEqual([{ name: 'fixturebin', sha256: sha256(SCRIPT), target: target(), created: true }])
    expect(readFileSync(target(), 'utf-8')).toBe(SCRIPT)
    expect(readInstalledBy(target())).toMatchObject({ package: 'plugin:terminal', version: '0.2.0', ref: 'main', sha256: sha256(SCRIPT) })
    const second = await installPluginBins([bin()], identity)
    expect(second[0]?.created).toBe(false)
    expect(hits).toBe(1)
    })
  })

  it('refuses a pin a pack holds differently — before any download', async () => {
    packPins('ocr@1.0.0', 'b'.repeat(64))
    await expect(withInstallLock(() => installPluginBins([bin()], identity))).rejects.toThrow(/package "ocr".*plugin "terminal"/)
    expect(hits).toBe(0)
  })

  it('reports an empty list without touching the lock when nothing is declared', async () => {
    expect(await installPluginBins([], identity)).toEqual([])
  })
})
