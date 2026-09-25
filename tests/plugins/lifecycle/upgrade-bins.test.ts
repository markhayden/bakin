/**
 * Binaries on upgrade (spec plugin-managed-binaries S7 / S17, local lane):
 *  - a re-pinned or added bin is a widening: the preview lists it in
 *    `newBins` and nothing moves until consent;
 *  - the accepted upgrade re-downloads the re-pinned bin, installs the new
 *    one, and records both in `installedBins`;
 *  - a bin the new manifest drops is deleted after the ledger write — only
 *    with zero remaining owners (S6 rule); another plugin's pin keeps it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-bins-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))
mock.module('@/core/plugin-registry', () => ({ isCorePlugin: () => false }))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))

import { upgradePlugin } from '../../../src/core/plugins/upgrade'
import { computeSourceTreeSha } from '../../../src/core/plugins/source-tree-sha'
import { addPlugin, readPluginLockfile, writePluginLockfile, type PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'
import { readInstalledBy, writeInstalledBy } from '../../../packages/core/src/agent-packages/markers'

const ONE_V1 = '#!/bin/sh\necho one v1\n'
const ONE_V2 = '#!/bin/sh\necho one v2\n'
const TWO = '#!/bin/sh\necho two\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
let NativeResponse: typeof Response
const SCRIPTS: Record<string, string> = { 'one-v1': ONE_V1, 'one-v2': ONE_V2, two: TWO }
const bin = (name: string, file: string) => ({
  name, version: file.endsWith('v2') ? '2.0.0' : '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/${file}`, sha256: sha256(SCRIPTS[file]!) } },
})
const binPath = (name: string) => join(testDir, 'bin', name)

function writeSource(source: string, id: string, version: string, bins: unknown[]): void {
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({ id, name: id, version, bakin: '*', description: 'bins fixture', requires: { bins } }, null, 2))
  writeFileSync(join(source, 'index.ts'), `export default { id: '${id}', activate() {} }`)
}

/** v1 installed: source + plugin dir + `one` on disk + ledger row pinning it. */
function seedInstalled(id: string): { source: string; pluginDir: string } {
  const source = join(testDir, `src-${id}`)
  const pluginDir = join(testDir, 'plugins', id)
  writeSource(source, id, '1.0.0', [bin('one', 'one-v1')])
  cpSync(source, pluginDir, { recursive: true })
  mkdirSync(join(testDir, 'bin'), { recursive: true })
  writeFileSync(binPath('one'), ONE_V1, { mode: 0o755 })
  writeInstalledBy(binPath('one'), { package: `plugin:${id}`, version: '1.0.0', ref: '', commitSha: '', sha256: sha256(ONE_V1), installedAt: '2026-09-01T00:00:00.000Z' })
  const entry: PluginLockEntry = {
    source, type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
    permissions: [], manifestSha: 'a'.repeat(64), sourceTreeSha: computeSourceTreeSha(source),
    installedBins: [{ name: 'one', sha256: sha256(ONE_V1) }],
  }
  writePluginLockfile(addPlugin(readPluginLockfile(), id, entry))
  return { source, pluginDir }
}

beforeAll(async () => {
  NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({
    port: 0,
    fetch: (req: Request) => new NativeResponse(SCRIPTS[new URL(req.url).pathname.slice(1)] ?? 'missing', { status: 200 }),
  })
})
afterAll(() => { server.stop(true); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })

describe('upgradePlugin — binaries (local lane)', () => {
  it('a re-pinned bin plus a new one is a widening: preview lists both, nothing moves; accepting installs both', async () => {
    const { source, pluginDir } = seedInstalled('rebin')
    writeSource(source, 'rebin', '2.0.0', [bin('one', 'one-v2'), bin('two', 'two')])

    const preview = await upgradePlugin('rebin')
    expect(preview.awaitingConsent).toBe(true)
    expect(preview.newPermissions).toEqual([])
    expect(preview.newBins.map((b) => [b.name, b.version, b.sha256])).toEqual([
      ['one', '2.0.0', sha256(ONE_V2)],
      ['two', '1.0.0', sha256(TWO)],
    ])
    expect(readFileSync(binPath('one'), 'utf-8')).toBe(ONE_V1)
    expect(existsSync(binPath('two'))).toBe(false)
    expect(JSON.parse(readFileSync(join(pluginDir, 'bakin-plugin.json'), 'utf-8')).version).toBe('1.0.0')

    const committed = await upgradePlugin('rebin', { accepted: preview.consent })
    expect(committed.awaitingConsent).toBe(false)
    expect(committed.after.version).toBe('2.0.0')
    expect(readFileSync(binPath('one'), 'utf-8')).toBe(ONE_V2)
    expect(readFileSync(binPath('two'), 'utf-8')).toBe(TWO)
    expect(readInstalledBy(binPath('two'))?.package).toBe('plugin:rebin')
    expect(readPluginLockfile().plugins.rebin?.installedBins).toEqual([
      { name: 'one', sha256: sha256(ONE_V2) },
      { name: 'two', sha256: sha256(TWO) },
    ])
    expect(committed.droppedBins).toEqual([])
  })

  it('a bin the new manifest drops is deleted with its marker after the ledger write — no consent needed for a narrowing', async () => {
    const { source } = seedInstalled('dropbin')
    writeSource(source, 'dropbin', '1.1.0', [])

    const result = await upgradePlugin('dropbin')
    expect(result.awaitingConsent).toBe(false)
    expect(result.droppedBins).toEqual(['one'])
    expect(existsSync(binPath('one'))).toBe(false)
    expect(existsSync(`${binPath('one')}.installedBy`)).toBe(false)
    expect(readPluginLockfile().plugins.dropbin?.installedBins).toBeUndefined()
  })

  it('a dropped bin another plugin still pins survives (zero-owner rule)', async () => {
    const { source } = seedInstalled('sharedrop')
    writePluginLockfile(addPlugin(readPluginLockfile(), 'otherplug', {
      source: '/elsewhere', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
      permissions: [], manifestSha: 'b'.repeat(64), installedBins: [{ name: 'one', sha256: sha256(ONE_V1) }],
    }))
    writeSource(source, 'sharedrop', '1.1.0', [])

    const result = await upgradePlugin('sharedrop')
    expect(result.droppedBins).toEqual([])
    expect(readFileSync(binPath('one'), 'utf-8')).toBe(ONE_V1)
    expect(readPluginLockfile().plugins.sharedrop?.installedBins).toBeUndefined()
  })

  it('a bin with no build for this platform is refused at preview — before consent, nothing moves', async () => {
    const { source, pluginDir } = seedInstalled('noplat')
    const other = platform.startsWith('darwin') ? 'linux-x64' : 'darwin-arm64'
    writeSource(source, 'noplat', '1.1.0', [{ name: 'one', version: '1.0.0', install: { [other]: { url: 'http://127.0.0.1:1/x', sha256: sha256(ONE_V1) } } }])
    await expect(upgradePlugin('noplat')).rejects.toThrow(/no build for this platform/)
    expect(JSON.parse(readFileSync(join(pluginDir, 'bakin-plugin.json'), 'utf-8')).version).toBe('1.0.0')
    expect(readPluginLockfile().plugins.noplat?.version).toBe('1.0.0')
  })
})
