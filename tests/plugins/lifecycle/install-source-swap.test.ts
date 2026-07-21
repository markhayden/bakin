/**
 * Install source-swap binding (commit C18 / review C2 fix verification).
 *
 * Original two-phase install flow returned `awaitingConsent + permissions`
 * but the commit call took just `accepted: true`. A direct HTTP caller
 * could preflight source A, then commit source B with accepted:true and
 * the server would install B without re-prompting.
 *
 * C13 added a HMAC-signed consentToken bound to (source, manifestSha,
 * permissions). These tests cover the binding:
 *  - Commit without a token is refused.
 *  - Commit with a token whose source disagrees is refused.
 *  - Commit with a manifest that changed between preflight and commit
 *    bounces back to awaitingConsent with manifestChanged=true.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-swap-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// buildUserPlugin would otherwise want bun.build to find a real index.ts —
// stub for these lifecycle tests.
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'

const sourceA = join(testDir, 'source-a')
const sourceB = join(testDir, 'source-b')

function writeFixture(dir: string, opts: { id: string; version: string; permissions: string[] }): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'),
    JSON.stringify({
      id: opts.id,
      name: opts.id,
      version: opts.version,
      bakin: '*',
      description: `${opts.id} test plugin`,
            permissions: opts.permissions,
    }, null, 2),
    'utf-8')
  writeFileSync(join(dir, 'index.ts'), `export default { id: '${opts.id}', activate() {} }`, 'utf-8')
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Each test starts with a clean source pair.
  rmSync(sourceA, { recursive: true, force: true })
  rmSync(sourceB, { recursive: true, force: true })
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  rmSync(join(testDir, 'plugins', 'lock.json'), { force: true })
})

describe('install consentToken binding', () => {
  it('commit without consentToken is refused when permissions exist', async () => {
    writeFixture(sourceA, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read'] })

    const res = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: true }),
      new URL('http://localhost/api/plugins/install'),
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/consentToken/i)
  })

  it('commit with mismatched-source token is refused', async () => {
    writeFixture(sourceA, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read'] })
    writeFixture(sourceB, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read'] })

    // Preflight against source A.
    const preflight = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: false }),
      new URL('http://localhost/api/plugins/install'),
    )
    const preflightBody = await preflight.json()
    expect(preflightBody.awaitingConsent).toBe(true)
    expect(preflightBody.consentToken).toBeTruthy()

    // Commit against source B with the source-A token — must refuse.
    const swap = await installPOST(
      makeRequest({ source: sourceB, type: 'local', accepted: true, consentToken: preflightBody.consentToken }),
      new URL('http://localhost/api/plugins/install'),
    )
    const swapBody = await swap.json()
    expect(swap.status).toBe(400)
    expect(swapBody.error).toMatch(/source does not match/i)
  })

  it('commit with manifest changed between preflight and commit re-prompts', async () => {
    writeFixture(sourceA, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read'] })

    // Preflight — token captures storage.read only.
    const preflight = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: false }),
      new URL('http://localhost/api/plugins/install'),
    )
    const preflightBody = await preflight.json()
    expect(preflightBody.awaitingConsent).toBe(true)
    expect(preflightBody.permissions).toEqual(['storage.read'])

    // Mutate the manifest BEFORE the commit attempt.
    writeFixture(sourceA, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read', 'storage.write'] })

    // Commit with the now-stale token — server must bounce back with
    // awaitingConsent + manifestChanged + a fresh token + the new diff.
    const commit = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: true, consentToken: preflightBody.consentToken }),
      new URL('http://localhost/api/plugins/install'),
    )
    const commitBody = await commit.json()
    expect(commitBody.awaitingConsent).toBe(true)
    expect(commitBody.manifestChanged).toBe(true)
    expect(commitBody.permissions).toEqual(['storage.read', 'storage.write'])
    expect(commitBody.consentToken).toBeTruthy()
    expect(commitBody.consentToken).not.toBe(preflightBody.consentToken)

    // Plugin dir must NOT exist — install was held at the consent gate.
    expect(existsSync(join(testDir, 'plugins', 'tok-test'))).toBe(false)
  })

  it('commit with valid matching token completes the install', async () => {
    writeFixture(sourceA, { id: 'tok-test', version: '1.0.0', permissions: ['storage.read'] })

    const preflight = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: false }),
      new URL('http://localhost/api/plugins/install'),
    )
    const preflightBody = await preflight.json()
    expect(preflightBody.awaitingConsent).toBe(true)

    const commit = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: true, consentToken: preflightBody.consentToken }),
      new URL('http://localhost/api/plugins/install'),
    )
    const commitBody = await commit.json()
    expect(commit.status).toBe(200)
    expect(commitBody.ok).toBe(true)
    expect(commitBody.id).toBe('tok-test')
  })

  it('successful install actually persists a lockfile entry (regression — C19)', async () => {
    // The original recordInstall read manifestPath from a now-deleted staging
    // dir, swallowed ENOENT, and returned ok:true with NO lockfile entry.
    // This pinned that bug — verify the entry IS persisted.
    writeFixture(sourceA, { id: 'persist-test', version: '1.2.3', permissions: [] })

    const res = await installPOST(
      makeRequest({ source: sourceA, type: 'local', accepted: true }),
      new URL('http://localhost/api/plugins/install'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // The lockfile entry MUST exist now — without it, upgrade / remove /
    // --check all 404 and the consent token is meaningless.
    const { readPluginLockfile } = await import('../../../packages/core/src/plugins/lockfile')
    const entry = readPluginLockfile().plugins['persist-test']
    expect(entry).toBeDefined()
    expect(entry?.version).toBe('1.2.3')
    expect(entry?.type).toBe('local')
    expect(entry?.manifestSha).toMatch(/^[a-f0-9]{64}$/)
  })
})
