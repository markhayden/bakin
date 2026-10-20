/**
 * POST /api/plugins/upgrade is two-phase (spec plugin-managed-binaries S17):
 * preview → awaitingConsent + token; commit with that token; a target that
 * changed since the preview bounces to awaitingConsent + manifestChanged with
 * a fresh token and mutates nothing; tokens are bound to the plugin.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, cpSync, existsSync, lstatSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-route-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../src/core/plugin-registry', () => ({ isCorePlugin: () => false }))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))
/**
 * The consent gate runs AFTER the identity is verified and BEFORE the replace
 * transaction places anything: a hook there is "the source moved between the
 * review and the placement" — the race review r5 #1 closed (captured before
 * the mock so the pass-through never recurses).
 */
import * as realGate from '../../../src/core/plugins/upgrade-gate'
const realGateUpgradeConsent = realGate.gateUpgradeConsent
const gateHook = { beforeGate: null as null | (() => void) }
mock.module('../../../src/core/plugins/upgrade-gate', () => ({
  ...realGate,
  gateUpgradeConsent: (args: Parameters<typeof realGateUpgradeConsent>[0]) => { gateHook.beforeGate?.(); return realGateUpgradeConsent(args) },
}))
mock.module('../../../src/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async () => ({ runtimeVersion: 1 }),
  isLiveActivationUnavailable: () => false,
}))

import { upgradePOST } from '../../helpers/plugin-routes'
import { pluginUpgradeOperation, post as upgradeRoute } from '../../../packages/host/src/api/plugins/upgrade'
import { getOperationRegistry } from '../../../src/core/operations'
import { waitUntil } from '../../helpers/wait'
import { computeSourceTreeSha } from '../../../src/core/plugins/source-tree-sha'
import { signConsentToken } from '../../../src/core/plugins/consent-token'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'

const ID = 'routeplug'
const source = join(testDir, 'source')
const pluginDir = join(testDir, 'plugins', ID)

function writeSource(version: string, permissions: string[]): void {
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({ id: ID, name: ID, version, bakin: '*', description: 'route fixture', permissions }))
  writeFileSync(join(source, 'index.ts'), `export default { id: '${ID}', activate() {} }`)
}
const post = async (body: unknown) => {
  const res = await upgradePOST(new Request('http://localhost/api/plugins/upgrade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), new URL('http://localhost/api/plugins/upgrade'))
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const installedVersion = () => (JSON.parse(readFileSync(join(pluginDir, 'bakin-plugin.json'), 'utf-8')) as { version: string }).version

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  writeSource('1.0.0', ['storage.read'])
  cpSync(source, pluginDir, { recursive: true })
  writePluginLockfile(addPlugin(readPluginLockfile(), ID, {
    source, type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
    permissions: ['storage.read'], manifestSha: 'a'.repeat(64), sourceTreeSha: computeSourceTreeSha(source),
  }))
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('POST /api/plugins/upgrade — the reviewed identity (review r4 #1, #3)', () => {
  it('local lane: the reviewed source-tree digest is held to — a tree that moved under the same manifest is refused, the installed plugin untouched', async () => {
    writeSource('1.1.0', [])
    const reviewed = computeSourceTreeSha(source)
    const preview = await post({ pluginId: ID, expected: { digest: reviewed } })
    expect(preview.body.ready).toBe(true)
    expect(preview.body.identity).toEqual({ version: '1.1.0', digest: reviewed })
    // Code changes, manifest does not: the consent token still matches, the digest does not.
    writeFileSync(join(source, 'index.ts'), `export default { id: '${ID}', activate() { /* moved */ } }`)
    const moved = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken, expected: { digest: reviewed } })
    expect(moved.status).toBe(400)
    expect(String(moved.body.error)).toMatch(/changed since it was reviewed — artifact/)
    expect(installedVersion()).toBe('1.0.0')
    expect(readPluginLockfile().plugins[ID]?.version).toBe('1.0.0')
    // Reviewing the moved tree installs it.
    const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken, expected: { digest: computeSourceTreeSha(source) } })
    expect(committed.body.ok).toBe(true)
    expect(installedVersion()).toBe('1.1.0')
  })

  it('local lane (review r5 #1): the install is the reviewed SNAPSHOT — the ledger digest and the installed tree are the reviewed digest even when the source moves between the verification and the placement', async () => {
    writeSource('1.1.0', [])
    const reviewed = computeSourceTreeSha(source)
    const preview = await post({ pluginId: ID, expected: { digest: reviewed } })
    gateHook.beforeGate = () => { writeFileSync(join(source, 'index.ts'), `export default { id: '${ID}', activate() { /* moved after the review */ } }`) }
    try {
      const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken, expected: { digest: reviewed } })
      expect(committed.body.ok).toBe(true)
      expect(committed.body.identity).toEqual({ version: '1.1.0', digest: reviewed })
    } finally {
      gateHook.beforeGate = null
    }
    expect(readPluginLockfile().plugins[ID]?.sourceTreeSha).toBe(reviewed)
    expect(computeSourceTreeSha(pluginDir)).toBe(reviewed)
    expect(computeSourceTreeSha(source)).not.toBe(reviewed)
    // No staging snapshot left behind.
    expect(readdirSync(join(testDir, 'plugins')).filter((n) => n.startsWith('.upgrade-staging'))).toEqual([])
  })

  it('local lane (review r6 #1): a symlinked source ROOT is resolved and installs as a real tree; a symlink INSIDE the source is refused — the digest cannot vouch for it', async () => {
    // Root symlink: the lock entry keeps pointing at the link, the snapshot is the real directory.
    const real = join(testDir, 'real-source')
    rmSync(source, { recursive: true, force: true })
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'bakin-plugin.json'), JSON.stringify({ id: ID, name: ID, version: '1.1.0', bakin: '*', description: 'route fixture', permissions: [] }))
    writeFileSync(join(real, 'index.ts'), `export default { id: '${ID}', activate() {} }`)
    symlinkSync(real, source)
    const reviewed = computeSourceTreeSha(source)
    const preview = await post({ pluginId: ID, expected: { digest: reviewed } })
    const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken, expected: { digest: reviewed } })
    expect(committed.body.ok).toBe(true)
    expect(installedVersion()).toBe('1.1.0')
    expect(lstatSync(pluginDir).isSymbolicLink()).toBe(false)
    expect(computeSourceTreeSha(pluginDir)).toBe(reviewed)

    // Nested symlink: refused before anything is placed.
    writeFileSync(join(testDir, 'elsewhere.ts'), 'export const live = true')
    symlinkSync(join(testDir, 'elsewhere.ts'), join(real, 'linked.ts'))
    writeFileSync(join(real, 'bakin-plugin.json'), JSON.stringify({ id: ID, name: ID, version: '1.2.0', bakin: '*', description: 'route fixture', permissions: [] }))
    const refused = await post({ pluginId: ID })
    expect(refused.status).toBe(400)
    expect(String(refused.body.error)).toMatch(/symlinked entries \(linked\.ts\)/)
    expect(installedVersion()).toBe('1.1.0')
    expect(readdirSync(join(testDir, 'plugins')).filter((n) => n.startsWith('.upgrade-staging'))).toEqual([])
  })

  it('local lane (review r7 #1, r8 #2): the snapshot is the install\'s transfer set — root dist/node_modules never ride (a `dist` symlink to a live directory does not reach the installed plugin), while dot entries and nested dist do, and the digest covers them', async () => {
    writeSource('1.1.0', [])
    const external = join(testDir, 'external-dist')
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, 'index.js'), 'export default "reviewed build"')
    symlinkSync(external, join(source, 'dist'))
    // Declared dependencies: root node_modules is the build's to regenerate, never transferred.
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: ID, version: '1.1.0', dependencies: { dep: '^1' } }))
    mkdirSync(join(source, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(source, 'node_modules', 'dep', 'index.js'), 'export const dep = 1')
    writeFileSync(join(source, '.runtime.json'), '{"keep":true}')
    mkdirSync(join(source, 'assets', 'dist'), { recursive: true })
    writeFileSync(join(source, 'assets', 'dist', 'schema.json'), '{"keep":true}')
    const reviewed = computeSourceTreeSha(source)
    const preview = await post({ pluginId: ID, expected: { digest: reviewed } })
    expect(preview.body.ready).toBe(true)
    // The link's target moves after the review: the install must not carry the link at all.
    gateHook.beforeGate = () => { writeFileSync(join(external, 'index.js'), 'export default "unreviewed build"') }
    try {
      const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken, expected: { digest: reviewed } })
      expect(committed.body.ok).toBe(true)
    } finally {
      gateHook.beforeGate = null
    }
    expect(installedVersion()).toBe('1.1.0')
    expect(existsSync(join(pluginDir, 'dist'))).toBe(false)
    expect(existsSync(join(pluginDir, 'node_modules'))).toBe(false)
    expect(readFileSync(join(pluginDir, '.runtime.json'), 'utf-8')).toBe('{"keep":true}')
    expect(readFileSync(join(pluginDir, 'assets', 'dist', 'schema.json'), 'utf-8')).toBe('{"keep":true}')
    expect(computeSourceTreeSha(pluginDir)).toBe(reviewed)
    expect(readPluginLockfile().plugins[ID]?.sourceTreeShaAlgo).toBe(3)
    expect(readdirSync(join(testDir, 'plugins')).filter((n) => n.startsWith('.upgrade-staging'))).toEqual([])
  })

  it('two commits with the same token but different reviewed identities are two operations: the second runs its own guard instead of attaching to the first', async () => {
    writeSource('1.1.0', [])
    const reviewed = computeSourceTreeSha(source)
    const preview = await post({ pluginId: ID, expected: { digest: reviewed } })
    const token = preview.body.consentToken as string
    // The raw route: its 202/200 answers carry the operation id (and `attached` when a live twin was joined).
    const start = async (body: unknown) => {
      const res = await upgradeRoute(new Request('http://localhost/api/plugins/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      return await res.json() as { operationId: string; attached?: true }
    }
    // The wrong identity goes first and holds install-state (its first stage is active) when the right one arrives:
    // the right one overlaps a LIVE operation for the same plugin and token and must not join it.
    const wrong = await start({ pluginId: ID, accepted: true, consentToken: token, expected: { digest: 'f'.repeat(64) } })
    await waitUntil(() => getOperationRegistry().get(wrong.operationId)?.stages.some((s) => s.status === 'active') === true, { label: 'the first commit is running under install-state' })
    const right = await start({ pluginId: ID, accepted: true, consentToken: token, expected: { digest: reviewed } })
    expect(right.attached).toBeUndefined()
    expect(right.operationId).not.toBe(wrong.operationId)
    const rightView = await getOperationRegistry().await(right.operationId)
    const wrongView = await getOperationRegistry().await(wrong.operationId)
    expect(rightView.result?.body).toMatchObject({ ok: true })
    expect(wrongView.result?.httpStatus).toBe(400)
    expect(String((wrongView.result?.body as { error: string }).error)).toMatch(/changed since it was reviewed/)
    expect(installedVersion()).toBe('1.1.0')
    // Same request twice IS one operation.
    const again = await start({ pluginId: ID, accepted: true, consentToken: token, expected: { digest: reviewed } })
    expect(pluginUpgradeOperation(ID, { pluginId: ID, accepted: true, consentToken: token, expected: { digest: reviewed } }, 'web').fingerprint)
      .toBe(pluginUpgradeOperation(ID, { pluginId: ID, accepted: true, consentToken: token, expected: { digest: reviewed } }, 'cli').fingerprint)
    expect(typeof again.operationId).toBe('string')
  })
})

describe('POST /api/plugins/upgrade — consent round trip', () => {
  it('preview → token → commit; a target changed in between bounces with a fresh token and mutates nothing', async () => {
    writeSource('1.1.0', ['storage.read', 'events.emit'])
    const preview = await post({ pluginId: ID })
    expect(preview.body.ok).toBe(false)
    expect(preview.body.awaitingConsent).toBe(true)
    // The FULL declaration — the unchanged storage.read included.
    expect(preview.body.declaredPermissions).toEqual(['storage.read', 'events.emit'])
    expect(preview.body.declaredBins).toEqual([])
    expect(typeof preview.body.consentToken).toBe('string')
    expect(installedVersion()).toBe('1.0.0')

    // The source moves on before the user accepts.
    writeSource('1.2.0', ['storage.read', 'storage.write'])
    const stale = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken })
    expect(stale.body.awaitingConsent).toBe(true)
    expect(stale.body.manifestChanged).toBe(true)
    expect(stale.body.declaredPermissions).toEqual(['storage.read', 'storage.write'])
    expect(stale.body.consentToken).not.toBe(preview.body.consentToken)
    expect(installedVersion()).toBe('1.0.0')
    expect(readPluginLockfile().plugins[ID]?.version).toBe('1.0.0')

    const committed = await post({ pluginId: ID, accepted: true, consentToken: stale.body.consentToken })
    expect(committed.status).toBe(200)
    expect(committed.body.ok).toBe(true)
    expect(committed.body.awaitingConsent).toBe(false)
    expect((committed.body.after as { version: string }).version).toBe('1.2.0')
    expect(installedVersion()).toBe('1.2.0')
    expect(readPluginLockfile().plugins[ID]?.permissions.sort()).toEqual(['storage.read', 'storage.write'])
  })

  it('rejects a commit without a token, with a forged token, or with a token issued for another plugin', async () => {
    writeSource('1.1.0', ['storage.read', 'events.emit'])
    expect((await post({ pluginId: ID, accepted: true })).status).toBe(400)
    expect((await post({ pluginId: ID, accepted: true, consentToken: 'bm9wZQ==.' + 'f'.repeat(64) })).status).toBe(400)
    const foreign = signConsentToken({ source: 'upgrade:someone-else', manifestSha: 'b'.repeat(64), permissions: [], bins: [] })
    const res = await post({ pluginId: ID, accepted: true, consentToken: foreign })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/different operation/)
    expect(installedVersion()).toBe('1.0.0')
  })

  it('an unchanged declaration still needs consent (the lockfile is never the baseline)', async () => {
    writeSource('1.1.0', ['storage.read'])
    const preview = await post({ pluginId: ID })
    expect(preview.body.ok).toBe(false)
    expect(preview.body.awaitingConsent).toBe(true)
    expect(preview.body.declaredPermissions).toEqual(['storage.read'])
    expect(installedVersion()).toBe('1.0.0')

    const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken })
    expect(committed.body.ok).toBe(true)
    expect(installedVersion()).toBe('1.1.0')
  })

  it('a target that declares nothing needs no consent: the preview is ready (never upgrades) and the commit applies it', async () => {
    writeSource('1.1.0', [])
    const preview = await post({ pluginId: ID })
    expect(preview.body.ok).toBe(true)
    expect(preview.body.ready).toBe(true)
    expect(preview.body.awaitingConsent).toBe(false)
    expect(typeof preview.body.consentToken).toBe('string')
    // A preview holds nothing and never writes outside staging.
    expect(installedVersion()).toBe('1.0.0')

    const committed = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken })
    expect(committed.body.ok).toBe(true)
    expect(installedVersion()).toBe('1.1.0')
  })
})
