/** The available-row sources: the Bakin release and installed plugins, over fake transports (#1007 D7.6). */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-available-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
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
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { updateIdentityKey } from '@makinbakin/sdk/types'
import { createUpdatesEngine } from '../../../../src/core/updates/engine'
import type { FetchLike } from '../../../../src/core/updates/net'
import { BAKIN_RECORD_ID, createBakinSource } from '../../../../src/core/updates/sources/bakin'
import { createPluginSource, type PluginSourceDeps } from '../../../../src/core/updates/sources/plugin'
import { INDEX_FILENAME } from '../../../../src/core/whiskit/artifacts-index'

const LATEST = 'https://api.github.com/repos/markhayden/bakin/releases/latest'
const LIST = 'https://api.github.com/repos/markhayden/bakin/releases?per_page=20'

/** A scripted HTTP transport: per-URL responders, every request recorded. */
function transport(routes: Record<string, (init?: { headers?: Record<string, string> }) => Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} })
    const route = routes[url]
    if (!route) return new Response('not scripted', { status: 599 })
    return route(init)
  }
  return { fetch, calls }
}
const json = (body: unknown, headers: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('bakin source', () => {
  const engine = (sources: Parameters<typeof createUpdatesEngine>[0]['sources'], path = join(testDir, `${randomUUID()}.json`), now = () => Date.now()) =>
    createUpdatesEngine({ storePath: path, sources, intervalMs: 3_600_000, now })

  it('a newer stable release is available with the apply action, the release notes link and the tag as source ref', async () => {
    const t = transport({ [LATEST]: () => json({ tag_name: 'v0.1.1', html_url: 'https://github.com/markhayden/bakin/releases/tag/v0.1.1', assets: [] }, { ETag: '"r1"' }) })
    const source = createBakinSource({ currentVersion: () => '0.1.0', execPath: () => '/opt/bakin/bakin', platform: () => 'darwin-arm64', fetch: t.fetch })
    const record = await engine([source]).observe(BAKIN_RECORD_ID)
    expect(record).toMatchObject({
      outcome: 'update-available', reason: 'newer-version', installed: { version: '0.1.0' }, available: { version: '0.1.1', display: 'v0.1.1' },
      source: { kind: 'github-release', endpoint: LATEST, ref: 'v0.1.1' }, notesUrl: 'https://github.com/markhayden/bakin/releases/tag/v0.1.1',
      action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] },
    })
    expect(t.calls[0]?.headers['User-Agent']).toBe('bakin-self-update')
  })

  it('the same version (or older) is current; a 304 after a restart reuses the persisted body without a second download', async () => {
    let served = 0
    const t = transport({ [LATEST]: (init) => { if (init?.headers?.['If-None-Match'] === '"r1"') return new Response(null, { status: 304 }); served += 1; return json({ tag_name: 'v0.1.0', assets: [] }, { ETag: '"r1"' }) } })
    const source = () => createBakinSource({ currentVersion: () => '0.1.0', execPath: () => '/opt/bakin/bakin', platform: () => 'darwin-arm64', fetch: t.fetch })
    const path = join(testDir, 'bakin-304.json')
    expect((await engine([source()], path).observe(BAKIN_RECORD_ID)).outcome).toBe('current')
    const second = engine([source()], path) // restart: conditional state comes from the file
    const record = await second.observe(BAKIN_RECORD_ID)
    expect(record.outcome).toBe('current')
    expect(record.attempt?.error).toBeUndefined()
    expect(served).toBe(1)
    expect(t.calls[1]?.headers['If-None-Match']).toBe('"r1"')
  })

  it('a rate-limited answer is a failed attempt whose next check honours the server\'s reset time', async () => {
    // The hint is relative to the wall clock (the header is an epoch), so the engine runs on the real clock here.
    const resetAt = Math.floor(Date.now() / 1000) + 2 * 3600
    const t = transport({ [LATEST]: () => new Response('', { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) } }) })
    const source = createBakinSource({ currentVersion: () => '0.1.0', execPath: () => '/opt/bakin/bakin', platform: () => 'darwin-arm64', fetch: t.fetch })
    const e = engine([source])
    const record = await e.observe(BAKIN_RECORD_ID)
    expect(record.outcome).toBe('unknown')
    expect(record.attempt?.error).toMatch(/HTTP 403/)
    const schedule = await e.scheduleFor(BAKIN_RECORD_ID)
    // The server's hint (2 h), not the 15 min first backoff — within a few seconds of the reset epoch.
    expect(Math.abs(Date.parse(schedule!.nextDueAt!) - resetAt * 1000)).toBeLessThan(5_000)
  })

  it('falls back to the release list when the repo only has prereleases, skipping drafts', async () => {
    const t = transport({
      [LATEST]: () => new Response('', { status: 404 }),
      [LIST]: () => json([{ tag_name: 'v0.2.0-rc.1', draft: true, assets: [] }, { tag_name: 'v0.1.2-rc.3', prerelease: true, assets: [] }]),
    })
    const source = createBakinSource({ currentVersion: () => '0.1.1', execPath: () => '/opt/bakin/bakin', platform: () => 'darwin-arm64', fetch: t.fetch })
    const record = await engine([source]).observe(BAKIN_RECORD_ID)
    expect(record).toMatchObject({ outcome: 'update-available', available: { version: '0.1.2-rc.3' } })
    expect(t.calls.map((c) => c.url)).toEqual([LATEST, LIST])
  })

  it('a source/dev runtime or an unsupported platform is unsupported — never current, no network', async () => {
    const t = transport({})
    const dev = createBakinSource({ currentVersion: () => '0.0.0-dev', execPath: () => '/usr/local/bin/bun', platform: () => 'darwin-arm64', fetch: t.fetch })
    const record = await engine([dev]).observe(BAKIN_RECORD_ID)
    expect(record.outcome).toBe('unsupported')
    expect(record.blockedReason).toContain('source/dev runtime')
    expect(record.action?.kind).toBe('manual')
    const noBinary = createBakinSource({ currentVersion: () => '0.1.0', execPath: () => '/opt/bakin/bakin', platform: () => null, fetch: t.fetch })
    expect((await engine([noBinary]).observe(BAKIN_RECORD_ID)).outcome).toBe('unsupported')
    expect(t.calls).toEqual([])
  })
})

describe('plugin source', () => {
  const lock = (overrides: Partial<PluginLockEntry> = {}): PluginLockEntry => ({
    source: 'github:markhayden/bakin-bits-official#plugins/projects', type: 'github', ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z',
    version: '0.11.4', permissions: [], manifestSha: 'm1', ...overrides,
  })
  const index = (versions: Record<string, { contract: string; range: string }>, latest: string) => ({
    version: 1,
    plugins: { projects: { latest, versions: Object.fromEntries(Object.entries(versions).map(([v, { contract, range }]) => [v, { platforms: { neutral: { url: `https://example.test/${v}.tgz`, sha256: 'a'.repeat(64), externalsContract: contract, bakinRange: range } } }])) } },
  })
  const INDEX_URL = `https://github.com/markhayden/bakin-bits-official/releases/latest/download/${INDEX_FILENAME}`

  function deps(overrides: Partial<PluginSourceDeps> = {}): PluginSourceDeps {
    return {
      lockEntries: () => ({ projects: lock() }),
      host: () => ({ version: '0.0.1-rc.41', platform: 'darwin-arm64', contract: 'react19-sdk-focused-v2' }),
      artifact: () => ({ installed: true, runs: true }),
      artifactSource: () => ({ baseUrl: 'https://github.com/markhayden/bakin-bits-official/releases/latest/download', pluginId: 'projects' }),
      cloneUrl: (source) => `https://github.com/${source.slice('github:'.length).split('#')[0]}.git`,
      lsRemote: async () => null,
      localTree: (_id: string) => ({ changed: false, liveSha: 'live' }),
      ...overrides,
    }
  }
  const ctx = (fetch?: FetchLike) => ({ signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} }, fetch })

  it('an artifact install: a newer compatible publish is available; a newer publish for another Bakin is blocked honestly; the same version is current', async () => {
    const t = transport({ [INDEX_URL]: () => json(index({ '0.11.4': { contract: 'react19-sdk-focused-v2', range: '>=0.0.1-rc.41' }, '0.11.5': { contract: 'react19-sdk-focused-v2', range: '>=0.0.1-rc.41' } }, '0.11.5')) })
    const source = createPluginSource(deps({ fetch: t.fetch }))
    const [entry] = await source.inventory()
    expect(entry).toMatchObject({ subject: { kind: 'plugin', id: 'projects' }, group: 'available', source: { kind: 'artifact-index', endpoint: 'github:markhayden/bakin-bits-official#plugins/projects' } })
    expect(await source.observe(entry!, ctx())).toMatchObject({ outcome: 'update-available', reason: 'newer-version', installed: { version: '0.11.4' }, available: { version: '0.11.5', display: '0.11.5' }, action: { kind: 'operation', start: { route: '/api/updates/plugin%3Aprojects/apply' } } })

    const future = transport({ [INDEX_URL]: () => json(index({ '0.11.4': { contract: 'react19-sdk-focused-v2', range: '>=0.0.1-rc.41' }, '0.12.0': { contract: 'react19-sdk-focused-v2', range: '>=0.0.1-rc.60' } }, '0.12.0')) })
    const blocked = await createPluginSource(deps({ fetch: future.fetch })).observe(entry!, ctx())
    expect(blocked).toMatchObject({ outcome: 'current' }) // 0.11.4 still runs; nothing newer runs here
    const stranded = await createPluginSource(deps({ fetch: future.fetch, artifact: () => ({ installed: true, runs: false }) })).observe(entry!, ctx())
    expect(stranded).toMatchObject({ outcome: 'update-available', reason: 'compatible-rebuild', available: { version: '0.11.4' } })
    const nothingRuns = transport({ [INDEX_URL]: () => json(index({ '0.12.0': { contract: 'react19-sdk-focused-v2', range: '>=0.0.1-rc.60' } }, '0.12.0')) })
    expect(await createPluginSource(deps({ fetch: nothingRuns.fetch })).observe(entry!, ctx())).toMatchObject({ outcome: 'blocked', blockedReason: expect.stringContaining('newest is 0.12.0') })
  })

  it('a git-ref install compares ls-remote against the recorded commit under the observe signal; a vanished ref blocks', async () => {
    const entry = lock({ ref: 'main', commitSha: 'a'.repeat(40) })
    const seen: { signal: AbortSignal | null } = { signal: null }
    const source = createPluginSource(deps({ lockEntries: () => ({ projects: entry }), artifact: () => ({ installed: false, runs: false }), lsRemote: async (_url, _ref, signal) => { seen.signal = signal; return 'b'.repeat(40) } }))
    const [inv] = await source.inventory()
    expect(inv!.source).toEqual({ kind: 'git-ref', endpoint: entry.source, ref: 'main' })
    const controller = new AbortController()
    const moved = await source.observe(inv!, { ...ctx(), signal: controller.signal })
    expect(seen.signal).toBe(controller.signal)
    expect(moved).toMatchObject({ outcome: 'update-available', reason: 'newer-commit', installed: { sha: 'a'.repeat(40) }, available: { sha: 'b'.repeat(40), display: 'bbbbbbb' } })
    const same = await createPluginSource(deps({ lockEntries: () => ({ projects: entry }), artifact: () => ({ installed: false, runs: false }), lsRemote: async () => 'a'.repeat(40) })).observe(inv!, ctx())
    expect(same.outcome).toBe('current')
    const gone = await createPluginSource(deps({ lockEntries: () => ({ projects: entry }), artifact: () => ({ installed: false, runs: false }), lsRemote: async () => null })).observe(inv!, ctx())
    expect(gone).toMatchObject({ outcome: 'blocked', blockedReason: 'no remote ref: main' })
  })

  it('a local install compares the live source tree; a missing path blocks', async () => {
    const dir = join(testDir, 'local-plugin')
    mkdirSync(dir, { recursive: true })
    const entry = lock({ type: 'local', source: dir, ref: '', commitSha: '', sourceTreeSha: 'old', sourceTreeShaAlgo: 2 })
    const changed = await createPluginSource(deps({ lockEntries: () => ({ projects: entry }), artifact: () => ({ installed: false, runs: false }), localTree: (_id: string) => ({ changed: true, liveSha: 'new' }) })).observe({ subject: { kind: 'plugin', id: 'projects', label: 'projects' }, group: 'available', fingerprint: 'f', source: { kind: 'local-path', endpoint: dir } }, ctx())
    expect(changed).toMatchObject({ outcome: 'update-available', reason: 'newer-commit', available: { digest: 'new', display: 'local changes' } })
    const missing = await createPluginSource(deps({ lockEntries: () => ({ projects: { ...entry, source: join(testDir, 'nope') } }), artifact: () => ({ installed: false, runs: false }) })).observe({ subject: { kind: 'plugin', id: 'projects', label: 'projects' }, group: 'available', fingerprint: 'f', source: { kind: 'local-path', endpoint: dir } }, ctx())
    expect(missing.outcome).toBe('blocked')
  })

  it('a linked dev install is unsupported, never an offer: the server runs the source tree and upgradePlugin refuses it', async () => {
    const dir = join(testDir, 'linked-plugin')
    mkdirSync(dir, { recursive: true })
    const entry = lock({ type: 'local', source: dir, ref: '', commitSha: '', linked: true, linkedSource: dir, sourceTreeSha: 'old', sourceTreeShaAlgo: 2 })
    let treeReads = 0
    const source = createPluginSource(deps({ lockEntries: () => ({ projects: entry }), artifact: () => ({ installed: false, runs: false }), localTree: (_id: string) => { treeReads += 1; return { changed: true, liveSha: 'edited' } } }))
    const [inv] = await source.inventory()
    const observed = await source.observe(inv!, ctx())
    expect(observed).toMatchObject({ outcome: 'unsupported', source: { kind: 'local-path', endpoint: dir }, action: { kind: 'manual', pointer: expect.stringContaining('bakin plugins unlink projects') } })
    expect(observed.available).toBeUndefined()
    expect(treeReads).toBe(0) // the live tree is the developer's edit, not evidence
  })

  it('the fingerprint moves with the lock entry AND with the host (version, platform, contract) — artifact eligibility depends on both', async () => {
    let host = { version: '0.0.1-rc.41', platform: 'darwin-arm64', contract: 'react19-sdk-focused-v2' }
    let entry = lock()
    const source = createPluginSource(deps({ lockEntries: () => ({ projects: entry }), host: () => host }))
    const a = (await source.inventory())[0]!.fingerprint
    host = { ...host, version: '0.0.1-rc.42' }
    const b = (await source.inventory())[0]!.fingerprint
    entry = lock({ version: '0.11.5' })
    const c = (await source.inventory())[0]!.fingerprint
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('review round 1 — artifact identity (#10)', () => {
  const lockEntry: PluginLockEntry = { source: 'github:markhayden/bakin-bits-official#plugins/projects', type: 'github', ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', version: '0.11.4', permissions: [], manifestSha: 'm1' }
  const sourceDeps = (sha: string): PluginSourceDeps => ({
    lockEntries: () => ({ projects: lockEntry }),
    host: () => ({ version: '0.0.1-rc.41', platform: 'darwin-arm64', contract: 'react19-sdk-focused-v2' }),
    artifact: () => ({ installed: true, runs: true }),
    artifactSource: () => ({ baseUrl: 'https://github.com/markhayden/bakin-bits-official/releases/latest/download', pluginId: 'projects' }),
    cloneUrl: (source) => source,
    lsRemote: async () => null,
    localTree: (_id: string) => ({ changed: false, liveSha: 'live' }),
    fetch: async () => new Response(JSON.stringify({ version: 1, plugins: { projects: { latest: '1.1.0', versions: { '1.1.0': { platforms: { neutral: { url: 'https://example.test/1.1.0.tgz', sha256: sha, externalsContract: 'react19-sdk-focused-v2', bakinRange: '>=0.0.0' } } } } } } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  const context = () => ({ signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })

  it('an artifact offer carries the selected entry\'s sha256 as its digest: two publications under one version are two offers, so a skip of the first lapses', async () => {
    const first = createPluginSource(sourceDeps('1'.repeat(64)))
    const [entry] = await first.inventory()
    const offered = await first.observe(entry!, context())
    expect(offered).toMatchObject({ outcome: 'update-available', available: { version: '1.1.0', digest: '1'.repeat(64) } })
    const republished = await createPluginSource(sourceDeps('2'.repeat(64))).observe(entry!, context())
    expect(republished.available?.digest).toBe('2'.repeat(64))
    expect(updateIdentityKey(offered.available)).not.toBe(updateIdentityKey(republished.available))
  })
})
