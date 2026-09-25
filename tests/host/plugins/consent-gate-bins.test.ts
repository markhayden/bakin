/**
 * Binaries are part of install consent (spec plugin-managed-binaries §2.5).
 *  - a manifest that declares `requires.bins` and ZERO permissions still
 *    requires consent, and the response lists the downloads;
 *  - the token binds the declared bins; a declaration that changes between
 *    preflight and commit bounces to awaitingConsent with no mutation;
 *  - a commit with the matching token proceeds.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-consent-bins-${Date.now()}-${randomUUID()}`)
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

const SCRIPT = '#!/bin/sh\necho tool\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
let NativeResponse: typeof Response
const source = join(testDir, 'source')

function writeFixture(opts: { sha: string; permissions?: string[] }): void {
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({
    id: 'toolplug', name: 'toolplug', version: '1.0.0', bakin: '*', description: 'declares a binary',
    ...(opts.permissions ? { permissions: opts.permissions } : {}),
    requires: { bins: [{
      name: 'tool', version: '1.0.0',
      install: { [platform]: { url: `http://127.0.0.1:${server.port}/tool`, sha256: opts.sha, sizeBytes: SCRIPT.length } },
    }] },
  }, null, 2))
  writeFileSync(join(source, 'index.ts'), "export default { id: 'toolplug', activate() {} }")
}
const request = (body: unknown) => new Request('http://localhost/api/plugins/install', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeAll(async () => {
  NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({ port: 0, fetch: () => new NativeResponse(SCRIPT) })
})
afterAll(() => { server.stop(true); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })

describe('install consent covers binaries', () => {
  it('a binary-only manifest (zero permissions) requires consent and the response lists the download', async () => {
    writeFixture({ sha: sha256(SCRIPT) })
    const res = await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))
    const body = await res.json() as { awaitingConsent?: boolean; consentToken?: string; permissions?: string[]; bins?: unknown[] }
    expect(body.awaitingConsent).toBe(true)
    expect(body.consentToken).toBeTruthy()
    expect(body.permissions).toEqual([])
    expect(body.bins).toEqual([{ name: 'tool', version: '1.0.0', sha256: sha256(SCRIPT), sizeBytes: SCRIPT.length }])
    expect(existsSync(join(testDir, 'plugins', 'toolplug'))).toBe(false)
  })

  it('a commit whose token was issued for a different binary pin bounces to consent with no mutation', async () => {
    writeFixture({ sha: sha256(SCRIPT) })
    const pre = await (await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))).json() as { consentToken: string }
    writeFixture({ sha: 'b'.repeat(64) }) // the declaration changed under the user
    const res = await installPOST(request({ source, type: 'local', accepted: true, consentToken: pre.consentToken }), new URL('http://localhost/api/plugins/install'))
    const body = await res.json() as { awaitingConsent?: boolean; manifestChanged?: boolean; bins?: Array<{ sha256: string }> }
    expect(body.awaitingConsent).toBe(true)
    expect(body.manifestChanged).toBe(true)
    expect(body.bins?.[0]?.sha256).toBe('b'.repeat(64))
    expect(existsSync(join(testDir, 'plugins', 'toolplug'))).toBe(false)
  })

  it('a commit with the matching token proceeds past the gate', async () => {
    writeFixture({ sha: sha256(SCRIPT) })
    const pre = await (await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))).json() as { consentToken: string }
    const res = await installPOST(request({ source, type: 'local', accepted: true, consentToken: pre.consentToken }), new URL('http://localhost/api/plugins/install'))
    const body = await res.json() as { awaitingConsent?: boolean; ok?: boolean; error?: string }
    expect(body.awaitingConsent).toBeUndefined()
    expect(body.ok, body.error).toBe(true)
  })
})
