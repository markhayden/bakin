/**
 * End-to-end coverage for monorepo `#subpath` installs (Phase 1 P1.C4).
 *
 * Spins up a hermetic bare git repo containing two plugins under
 * `plugins/foo/` and `plugins/bar/`, then exercises:
 *
 *   - Subpath install lands only the targeted plugin and skips the rest
 *     of the monorepo.
 *   - Lockfile records the full source string with `#subpath` so the
 *     upgrade flow (P1.C2) can re-resolve it.
 *   - Missing-subpath, missing-manifest-in-subpath, and the path-traversal
 *     class of malformed inputs all return clear 400s.
 *
 * Skips when `git` is not on PATH (CI parity with the hermetic-git
 * fixtures used elsewhere in lifecycle tests).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-subpath-${Date.now()}-${randomUUID()}`)
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
// Subpath install still calls the real Bun build at the end; stub it so
// the test stays hermetic. The build step is exercised separately in
// tests/api/plugins-build.test.ts.
const buildUserPluginCalls: Array<{ pluginDir: string; options?: Record<string, unknown> }> = []
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({
    buildUserPlugin: async (pluginDir: string, options?: Record<string, unknown>) => {
      buildUserPluginCalls.push({ pluginDir, options })
    },
  }),
)

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { createBareRepo, gitAvailable } from '../../fixtures/plugins/hermetic-git'

const monorepoRoot = join(testDir, 'monorepo-root')
let cloneUrl: string

const FOO_MANIFEST = JSON.stringify(
  {
    id: 'foo',
    name: 'Foo',
    version: '1.0.0',
    bakin: '*',
    description: 'Foo test plugin',
        permissions: [],
  },
  null, 2,
)
const BAR_MANIFEST = JSON.stringify(
  {
    id: 'bar',
    name: 'Bar',
    version: '0.5.0',
    bakin: '*',
    description: 'Bar test plugin',
        permissions: [],
  },
  null, 2,
)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function invoke(req: Request) {
  return installPOST(req, new URL(req.url))
}

beforeAll(() => {
  if (!gitAvailable()) return
  mkdirSync(testDir, { recursive: true })
  const { cloneUrl: url } = createBareRepo(monorepoRoot, 'monorepo', {
    'plugins/foo/bakin-plugin.json': FOO_MANIFEST,
    'plugins/foo/index.ts': `export default { id: 'foo', activate() {} }`,
    'plugins/bar/bakin-plugin.json': BAR_MANIFEST,
    'plugins/bar/index.ts': `export default { id: 'bar', activate() {} }`,
    // Sentinel file at the monorepo root that should NOT land in any
    // subpath install — the install flow must drop the rest of the
    // cloned repo, not just rename it.
    'README.md': 'monorepo root readme',
    // Empty dir holding no plugin manifest, used to test the "subpath
    // exists but contains no bakin-plugin.json" branch.
    'plugins/empty/.gitkeep': '',
  })
  cloneUrl = url
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  buildUserPluginCalls.length = 0
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
})

describe.skipIf(!gitAvailable())('install subpath — happy path', () => {
  it('installs only the targeted plugin from a monorepo subpath', async () => {
    const res = await invoke(makeRequest({
      source: `${cloneUrl}#plugins/foo`,
      type: 'github',
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.id).toBe('foo')

    // The targeted plugin landed at ~/.bakin/plugins/foo/.
    const fooDir = join(testDir, 'plugins', 'foo')
    expect(existsSync(join(fooDir, 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(fooDir, 'index.ts'))).toBe(true)
    // The monorepo's other plugin must NOT be installed alongside it.
    expect(existsSync(join(testDir, 'plugins', 'bar'))).toBe(false)
    // The monorepo root sentinel must NOT be copied into the plugin dir.
    expect(existsSync(join(fooDir, 'README.md'))).toBe(false)
    // Subpath installs intentionally drop the cloned repo's `.git/`.
    expect(existsSync(join(fooDir, '.git'))).toBe(false)
    // github installs build from the import-validated source — no dist trust.
    expect(buildUserPluginCalls.at(-1)?.options).toBeUndefined()
  })

  it('records the full source string (with #subpath) in the lockfile', async () => {
    const source = `${cloneUrl}#plugins/foo`
    const res = await invoke(makeRequest({ source, type: 'github' }))
    expect(res.status).toBe(200)

    const lock = readPluginLockfile()
    expect(lock.plugins.foo).toBeDefined()
    expect(lock.plugins.foo!.source).toBe(source)
    expect(lock.plugins.foo!.type).toBe('github')
    // Provenance is captured from the staging clone before the subpath copy
    // drops `.git/`, so pinned upgrades can remain deterministic.
    expect(lock.plugins.foo!.ref).toBe('main')
    expect(lock.plugins.foo!.commitSha).toMatch(/^[a-f0-9]{40}$/)
  })

  it('two subpath installs from the same monorepo can coexist', async () => {
    const fooRes = await invoke(makeRequest({
      source: `${cloneUrl}#plugins/foo`,
      type: 'github',
    }))
    expect(fooRes.status).toBe(200)
    const barRes = await invoke(makeRequest({
      source: `${cloneUrl}#plugins/bar`,
      type: 'github',
    }))
    expect(barRes.status).toBe(200)

    expect(existsSync(join(testDir, 'plugins', 'foo', 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins', 'bar', 'bakin-plugin.json'))).toBe(true)
    const lock = readPluginLockfile()
    expect(Object.keys(lock.plugins).sort()).toEqual(['bar', 'foo'])
  })
})

describe.skipIf(!gitAvailable())('install subpath — error paths', () => {
  it('rejects with 400 when the subpath does not exist in the repo', async () => {
    const res = await invoke(makeRequest({
      source: `${cloneUrl}#plugins/missing-plugin`,
      type: 'github',
    }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/subpath.*not found/i)
  })

  it('rejects with 400 when the subpath has no bakin-plugin.json', async () => {
    const res = await invoke(makeRequest({
      source: `${cloneUrl}#plugins/empty`,
      type: 'github',
    }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/missing bakin-plugin\.json/i)
  })

  it.each([
    'github:owner/repo#',
    'github:owner/repo#/plugins/foo',
    'github:owner/repo#plugins/../etc',
    'github:owner/repo#plugins/foo/',
    'github:owner/repo#a#b',
  ])('rejects malformed subpath input %p with 400', async (source) => {
    const res = await invoke(makeRequest({ source, type: 'github' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!gitAvailable())('install subpath — local type rejects subpath', () => {
  it('rejects local installs that include #subpath with a clear error', async () => {
    // Use a path that exists so we don't fall through to the path-not-found
    // branch — we want to hit the "local subpath unsupported" guard.
    const localPath = join(testDir, 'some-local-dir')
    mkdirSync(localPath, { recursive: true })
    const res = await invoke(makeRequest({
      source: `${localPath}#sub`,
      type: 'local',
    }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/local.*#subpath/i)
  })
})
