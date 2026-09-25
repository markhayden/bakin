/**
 * Plugin install is a transaction over binaries (spec plugin-managed-binaries
 * §2.6, S1b/S3/S4/S13):
 *  - a bin with no build for this platform fails at PREFLIGHT — before
 *    consent and before any mutation;
 *  - a successful install downloads every declared bin into ~/.bakin/bin,
 *    writes plugin:<id> markers and records `installedBins` in the ledger;
 *  - a failure on the SECOND bin leaves no plugin dir, no bin this install
 *    created, and no ledger entry; the retry succeeds and skips the first.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-bins-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { readInstalledBy } from '../../../packages/core/src/agent-packages/markers'

const ONE = '#!/bin/sh\necho one\n'
const TWO = '#!/bin/sh\necho two\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const otherPlatform = platform.startsWith('darwin') ? 'linux-x64' : 'darwin-arm64'
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
let NativeResponse: typeof Response
let failTwo = false
let hits: Record<string, number> = {}
const source = join(testDir, 'source')
const url = (name: string) => `http://127.0.0.1:${server.port}/${name}`

function writeFixture(bins: unknown[]): void {
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({
    id: 'toolplug', name: 'toolplug', version: '1.0.0', bakin: '*', description: 'declares binaries',
    requires: { bins },
  }, null, 2))
  writeFileSync(join(source, 'index.ts'), "export default { id: 'toolplug', activate() {} }")
}
const bin = (name: string, script: string, over: Record<string, unknown> = {}) => ({
  name, version: '1.0.0', install: { [platform]: { url: url(name), sha256: sha256(script) } }, ...over,
})
const request = (body: unknown) => new Request('http://localhost/api/plugins/install', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
async function install(): Promise<Record<string, unknown>> {
  const pre = await (await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))).json() as Record<string, unknown>
  if (!pre.awaitingConsent) return pre
  return await (await installPOST(request({ source, type: 'local', accepted: true, consentToken: pre.consentToken }), new URL('http://localhost/api/plugins/install'))).json() as Record<string, unknown>
}

beforeAll(async () => {
  NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({
    port: 0,
    fetch: (req: Request) => {
      const name = new URL(req.url).pathname.slice(1)
      hits[name] = (hits[name] ?? 0) + 1
      if (name === 'two' && failTwo) return new NativeResponse('nope', { status: 500 })
      return new NativeResponse(name === 'one' ? ONE : TWO)
    },
  })
})
afterAll(() => { server.stop(true); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); failTwo = false; hits = {} })

describe('install transaction over binaries', () => {
  it('S1b: a bin with no build for this platform fails at preflight — before consent, nothing written', async () => {
    writeFixture([{ name: 'one', version: '1.0.0', install: { [otherPlatform]: { url: url('one'), sha256: sha256(ONE) } } }])
    const res = await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))
    const body = await res.json() as { ok?: boolean; awaitingConsent?: boolean; error?: string }
    expect(res.status).toBe(400)
    expect(body.awaitingConsent).toBeUndefined()
    expect(body.error).toMatch(/"one".*no build.*platform/i)
    expect(existsSync(join(testDir, 'plugins', 'toolplug'))).toBe(false)
    expect(hits).toEqual({})
  })

  it('S3: installs every declared bin, writes plugin:<id> markers, records installedBins', async () => {
    writeFixture([bin('one', ONE), bin('two', TWO)])
    const body = await install()
    expect(body.ok, String(body.error)).toBe(true)
    expect(readFileSync(join(testDir, 'bin', 'one'), 'utf-8')).toBe(ONE)
    expect(readFileSync(join(testDir, 'bin', 'two'), 'utf-8')).toBe(TWO)
    expect(readInstalledBy(join(testDir, 'bin', 'one'))).toMatchObject({ package: 'plugin:toolplug', version: '1.0.0', sha256: sha256(ONE) })
    const entry = readPluginLockfile().plugins.toolplug!
    expect(entry.installedBins).toEqual([{ name: 'one', sha256: sha256(ONE) }, { name: 'two', sha256: sha256(TWO) }])
    expect(existsSync(join(testDir, 'plugins', 'toolplug', '.bakin-install.json'))).toBe(false)
  })

  it('S4/S13: a failure on the second bin leaves no plugin dir, no created bin, no ledger entry; the retry succeeds and skips the first', async () => {
    writeFixture([bin('one', ONE), bin('two', TWO)])
    failTwo = true
    const failed = await install()
    expect(failed.ok).toBe(false)
    expect(String(failed.error)).toMatch(/two/)
    expect(existsSync(join(testDir, 'plugins', 'toolplug'))).toBe(false)
    expect(existsSync(join(testDir, 'bin', 'one'))).toBe(false)
    expect(existsSync(join(testDir, 'bin', 'two'))).toBe(false)
    expect(readPluginLockfile().plugins.toolplug).toBeUndefined()

    failTwo = false
    const ok = await install()
    expect(ok.ok, String(ok.error)).toBe(true)
    expect(readPluginLockfile().plugins.toolplug?.installedBins).toHaveLength(2)
  })

  it('a bin another owner already pins identically is shared: not re-downloaded and NOT deleted by a later rollback', async () => {
    // Pre-existing identical pin owned by a pack.
    const { readLockfile, writeLockfile } = await import('../../../packages/core/src/agent-packages/lockfile')
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(join(testDir, 'bin', 'one'), ONE, { mode: 0o755 })
    const lock = readLockfile()
    lock.packages['ocr@1.0.0'] = { kind: 'skill-pack', version: '1.0.0', source: 'github:x/ocr', ref: '', commitSha: '', installedAt: new Date().toISOString(), projections: [{ kind: 'bin', target: join(testDir, 'bin', 'one'), sha256: sha256(ONE) }] }
    writeLockfile(lock)

    writeFixture([bin('one', ONE), bin('two', TWO)])
    failTwo = true
    const failed = await install()
    expect(failed.ok).toBe(false)
    expect(hits.one ?? 0).toBe(0)                       // shared pin: never downloaded
    expect(existsSync(join(testDir, 'bin', 'one'))).toBe(true)  // not ours to delete
  })
})
